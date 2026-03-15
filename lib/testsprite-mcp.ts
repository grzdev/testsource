import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface RunTestSpriteOptions {
  projectPath: string;
  projectName: string;
  targetUrl: string;
  apiKey: string;
  additionalInstruction?: string;
  needLogin?: boolean;
  projectDescription?: string;
}

export class TestSpriteApp {
  private child: ChildProcess | null = null;
  private messageCounter = 1;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private proxyServer: http.Server | null = null;

  public onLog?: (msg: string) => void;
  public onStage?: (stage: string) => void;

  private log(msg: string) {
    console.log(msg);
    if (this.onLog) this.onLog(msg);
  }

  private setStage(stage: string) {
    if (this.onStage) this.onStage(stage);
  }

  private checkAuth() {
    if ((this as any)._authError) {
      this.cleanup();
      throw new Error("TestSprite authentication failed. Please configure a valid TESTSPRITE_API_KEY.");
    }
  }

  async start(options: RunTestSpriteOptions) {
    const { projectPath, targetUrl, apiKey, projectName, additionalInstruction, needLogin = false, projectDescription = "" } = options;

    // 1. Resolve local endpoint — skip proxy for local dev servers
    let localEndpoint: string;
    if (targetUrl && !targetUrl.includes("localhost") && !targetUrl.includes("127.0.0.1")) {
      const proxyPort = await this.startProxy(targetUrl);
      localEndpoint = `http://localhost:${proxyPort}/`;
      this.log(`Proxying ${targetUrl} → ${localEndpoint}`);
    } else {
      localEndpoint = targetUrl.endsWith("/") ? targetUrl : `${targetUrl}/`;
    }

    // 2. Pre-create workspace structure + synthetic PRD
    await this.createConfig(projectPath, localEndpoint, projectName, apiKey, projectDescription);

    const tmpDir = path.join(projectPath, "testsprite_tests", "tmp");

    // 3. Spawn MCP process
    this.log(`> Starting TestSprite MCP with API key (present: ${!!apiKey})`);
    this.child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["-y", "@testsprite/testsprite-mcp@latest"],
      {
        env: {
          ...process.env,
          TESTSPRITE_API_KEY: apiKey,
          API_KEY: apiKey,
          BROWSER: "none",
          CI: "1",
          TESTSPRITE_NO_OPEN: "1",
          TESTSPRITE_NO_OPEN_BROWSER: "1",
          NO_OPEN: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      }
    );

    let buffer = "";
    this.child.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.error) {
            const errStr = JSON.stringify(msg.error).toLowerCase();
            if (errStr.includes("auth") || errStr.includes("unauthorized") || errStr.includes("invalid_key") || errStr.includes("api_key")) {
              (this as any)._authError = true;
            }
            if (msg.id && this.pendingRequests.has(msg.id)) {
              const { reject } = this.pendingRequests.get(msg.id)!;
              this.pendingRequests.delete(msg.id);
              reject(new Error(`MCP tool error: ${JSON.stringify(msg.error)}`));
              return;
            }
          }
          if (msg.id && this.pendingRequests.has(msg.id)) {
            const { resolve } = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            resolve(msg.result);
          }
        } catch {
          // non-JSON line from MCP process — ignore
        }
      }
    });

    this.child.stderr?.on("data", (data: Buffer) => {
      const str = data.toString();
      this.log(`[MCP stderr] ${str.trim().slice(0, 300)}`);
      if (
        str.includes("AUTH_FAILED") || str.includes("mcp_terminate") ||
        str.includes("Unauthorized") || str.includes("Invalid API key") ||
        str.includes("authentication failed")
      ) {
        (this as any)._authError = true;
      }
    });

    // 4. Handshake
    await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "testproof-mcp-client", version: "1.0.0" },
    });
    this.checkAuth();
    this.sendNotification("notifications/initialized", {});

    // ── Pre-flight: validate workspace structure ───────────────────────
    const configPath    = path.join(tmpDir, "config.json");
    const prdFilesCheck = path.join(tmpDir, "prd_files");
    try { await fs.stat(configPath);    this.log(`config.json found → ${configPath}`);       } catch { throw new Error("config.json missing — workspace setup failed before MCP start."); }
    try { await fs.stat(prdFilesCheck); this.log(`prd_files/ found → ${prdFilesCheck}`);     } catch { throw new Error("prd_files/ missing — workspace setup failed before MCP start."); }

    // ── Stage 1: Code Summary ────────────────────────────────────────────
    this.setStage("Generate code summary");
    this.log("Analyzing codebase...");
    const codeSummaryRes = await this.callTool("testsprite_generate_code_summary", { projectRootPath: projectPath });
    this.checkAuth();

    const codeSummaryText = this.extractText(codeSummaryRes);
    // TestSprite expects code_summary.json (not .yaml) in testsprite_tests/tmp/
    const codeSummaryPath = path.join(tmpDir, "code_summary.json");
    if (codeSummaryText && codeSummaryText.trim().length > 20) {
      // The tool may return YAML or JSON — store as-is; TestSprite reads it by filename
      await fs.writeFile(codeSummaryPath, codeSummaryText);
      this.log(`code_summary.json written → ${codeSummaryPath}`);
      // Also keep a .yaml copy since some versions look for that extension
      await fs.writeFile(path.join(tmpDir, "code_summary.yaml"), codeSummaryText);
    } else {
      // Check if the tool wrote it itself
      const selfWritten = await fs.stat(codeSummaryPath).then(() => true).catch(() => false)
        || await fs.stat(path.join(tmpDir, "code_summary.yaml")).then(() => true).catch(() => false);
      if (selfWritten) {
        this.log("code_summary already on disk (written by tool).");
      } else {
        throw new Error("[Stage 1] testsprite_generate_code_summary returned no content and code_summary.json was not written. Cannot continue.");
      }
    }

    // ── Stage 2: Standardized PRD ────────────────────────────────────────
    this.setStage("Generate PRD");
    this.log("Generating PRD...");
    const prdRes = await this.callTool("testsprite_generate_standardized_prd", { projectPath });
    this.checkAuth();

    const prdText = this.extractText(prdRes);
    const prdFilesDir = path.join(tmpDir, "prd_files");
    await fs.mkdir(prdFilesDir, { recursive: true });
    if (prdText && prdText.trim().length > 20) {
      const standardizedPrdPath = path.join(prdFilesDir, "standardized_prd.md");
      await fs.writeFile(standardizedPrdPath, prdText);
      this.log(`Standardized PRD saved → ${standardizedPrdPath}`);
    } else {
      this.log("PRD tool returned no content — using synthetic PRD already on disk.");
    }

    // ── Stage 3: Test Plan ───────────────────────────────────────────────
    this.setStage("Generate test plan");
    this.log("Generating Test Plan...");
    const testPlanRes = await this.callTool("testsprite_generate_frontend_test_plan", { projectPath, needLogin });
    this.checkAuth();

    const testPlanText = this.extractText(testPlanRes);
    if (testPlanText && testPlanText.trim().length > 20) {
      const testPlanPath = path.join(tmpDir, "test_plan.md");
      await fs.writeFile(testPlanPath, testPlanText);
      this.log(`Test plan saved → ${testPlanPath}`);
    } else {
      this.log("Test plan tool returned no content (non-fatal, continuing).");
    }

    // ── Stage 4: Generate & Execute ─────────────────────────────────────
    this.setStage("Generate and execute tests");
    this.log("Generating and executing tests...");
    const executeRes = await this.callTool("testsprite_generate_code_and_execute", {
      projectName,
      projectPath,
      testIds: [],
      additionalInstruction: additionalInstruction || "",
      serverMode: "development", // we always start with a dev server
    }, 600_000); // 10-minute timeout for test execution
    this.checkAuth();

    const executeText = this.extractText(executeRes);
    this.log(`Execute response length: ${executeText.length} chars`);
    if (executeText.trim().length > 0) {
      this.log(`Execute response preview: ${executeText.slice(0, 400)}`);
    }

    // Run any terminal commands from next_action — HARD FAIL if the command fails.
    // The real test_results.json is written by these commands.
    await this.processNextActions(executeRes, projectPath, {
      ...process.env,
      TESTSPRITE_API_KEY: apiKey,
      API_KEY: apiKey,
    });

    const testResultsPath = path.join(tmpDir, "test_results.json");

    // ── Finalize & validate results ──────────────────────────────────────
    this.setStage("Finalize results");

    const testResultsExists = await fs.stat(testResultsPath).then(() => true).catch(() => false);
    if (!testResultsExists) {
      throw new Error(
        "TestSprite execution did not produce test_results.json. " +
        "The terminal command ran but generated no output file. " +
        "The app may not have been accessible to Playwright, or test generation failed."
      );
    }

    let rawTestResults: any;
    try {
      rawTestResults = JSON.parse(await fs.readFile(testResultsPath, "utf-8"));
    } catch {
      throw new Error("test_results.json could not be parsed — the file may be malformed or empty.");
    }
    const testCount = Array.isArray(rawTestResults)
      ? rawTestResults.length
      : (rawTestResults?.tests?.length ?? rawTestResults?.summary?.total ?? 0);
    if (testCount === 0) {
      throw new Error(
        "test_results.json was generated but contains no test entries. " +
        "TestSprite could not execute any tests against the application. " +
        "The app may not have been reachable, or no interactable UI was found."
      );
    }
    this.log(`test_results.json valid — ${testCount} test entries found.`);

    // ── Parse results ────────────────────────────────────────────────────
    const resultCandidates = [
      testResultsPath,
      path.join(tmpDir, "results.json"),
      path.join(tmpDir, "result.json"),
    ];
    const reportCandidates = [
      path.join(projectPath, "TestSprite_MCP_Test_Report.md"),
      path.join(projectPath, "testsprite_tests", "TestSprite_MCP_Test_Report.md"),
      path.join(tmpDir, "test_report.md"),
    ];

    let results = null;
    for (const p of resultCandidates) {
      try { results = JSON.parse(await fs.readFile(p, "utf-8")); break; } catch {}
    }
    let report = "";
    for (const p of reportCandidates) {
      try { const s = await fs.readFile(p, "utf-8"); if (s) { report = s; break; } } catch {}
    }

    this.cleanup();
    return { results, report };
  }

  private async createConfig(projectPath: string, localEndpoint: string, projectName: string, apiKey: string, projectDescription: string) {
    const testspriteDir = path.join(projectPath, "testsprite_tests", "tmp");
    await fs.mkdir(testspriteDir, { recursive: true });

    // Also write .testsprite/config.json — this is what testsprite_bootstrap checks for
    // and what some MCP tool versions read for project configuration.
    const dotTestspriteDir = path.join(projectPath, ".testsprite");
    await fs.mkdir(dotTestspriteDir, { recursive: true });

    const portMatch = localEndpoint.match(/:(\d{4,5})/);
    const localPort = portMatch ? parseInt(portMatch[1], 10) : 3000;

    const dotConfig = {
      status: "commited",
      scope: "codebase",
      type: "frontend",
      serverMode: "development",
      localEndpoint,
      localPort,
    };
    await fs.writeFile(
      path.join(dotTestspriteDir, "config.json"),
      JSON.stringify(dotConfig, null, 2)
    );

    // Create prd_files directory with a synthetic PRD so testsprite_generate_standardized_prd
    // has a source document to work from (it fails with ENOENT if prd_files is empty).
    const prdFilesDir = path.join(testspriteDir, "prd_files");
    await fs.mkdir(prdFilesDir, { recursive: true });
    const syntheticPrd = [
      `# Product Requirements Document: ${projectName}`,
      "",
      "## Overview",
      projectDescription ||
        `${projectName} is a web application undergoing automated frontend testing.`,
      "",
      "## Core Features",
      "- Web-based user interface with interactive components",
      "- Standard navigation and page routing",
      "- User-facing flows and state management",
      "",
      "## Test Objectives",
      "- Validate core user-facing functionality and interactions",
      "- Ensure navigation and routing work correctly across all pages",
      "- Verify UI components render, respond, and handle edge cases properly",
      "",
      "## Test Scope",
      "- Frontend: Full UI testing including user flows and component interactions",
      "- Type: Frontend-focused testing with Playwright",
    ].join("\n");
    await fs.writeFile(path.join(prdFilesDir, "prd.md"), syntheticPrd);

    const config = {
      status: "commited",
      scope: "codebase",
      type: "frontend",
      serverMode: "development",
      localEndpoint,
      localPort,
      executionArgs: {
        projectName,
        projectPath,
        testIds: [],
        additionalInstruction: "",
        serverMode: "development",
        envs: { API_KEY: apiKey },
      },
    };

    await fs.writeFile(
      path.join(testspriteDir, "config.json"),
      JSON.stringify(config, null, 2)
    );
  }

  private startProxy(targetUrl: string): Promise<number> {
    return new Promise((resolve) => {
      const target = new URL(targetUrl);
      const server = http.createServer((req, res) => {
        const options = {
          hostname: target.hostname,
          port: target.port || (target.protocol === "https:" ? 443 : 80),
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: target.host },
        };

        const proto = target.protocol === "https:" ? https : http;
        const proxy = proto.request(options, (r) => {
          if (r.statusCode) {
            res.writeHead(r.statusCode, r.headers);
            r.pipe(res);
          } else {
            res.writeHead(500);
            res.end();
          }
        });

        proxy.on("error", (err) => {
          console.error("Proxy error:", err);
          res.writeHead(502);
          res.end("Bad Gateway - Error proxying request");
        });

        req.pipe(proxy);
      });

      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as any)?.port;
        this.proxyServer = server;
        resolve(port);
      });
    });
  }

  private sendRequest(method: string, params: object, timeoutMs = 300_000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin) return reject(new Error("MCP process not running"));
      const id = this.messageCounter++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request timed out after ${timeoutMs / 1000}s (method=${method})`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject:  (err) => { clearTimeout(timer); reject(err); },
      });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.child.stdin.write(msg + "\n");
    });
  }

  private sendNotification(method: string, params: object): void {
    if (!this.child || !this.child.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.child.stdin.write(msg + "\n");
  }

  private callTool(name: string, args: object, timeoutMs = 300_000): Promise<any> {
    return this.sendRequest("tools/call", { name, arguments: args }, timeoutMs);
  }

  private async processNextActions(
    result: any,
    projectPath: string,
    extraEnv: NodeJS.ProcessEnv = {}
  ): Promise<void> {
    const text = this.extractText(result);
    const tmpDir = path.join(projectPath, "testsprite_tests", "tmp");
    const testResultsPath = path.join(tmpDir, "test_results.json");
    // Artifact paths polled after success marker is observed
    const artifactPaths = [
      testResultsPath,
      path.join(projectPath, "TestSprite_MCP_Test_Report.md"),
      path.join(projectPath, "TestSprite_MCP_Test_Report.html"),
      path.join(tmpDir, "TestSprite_MCP_Test_Report.md"),
      path.join(tmpDir, "TestSprite_MCP_Test_Report.html"),
    ];

    // Markers in stdout that confirm test execution finished even if process stays alive
    const SUCCESS_MARKERS = [
      "test execution completed",
      "execution lock released",
    ];
    const checkMarkers = (buf: string) =>
      SUCCESS_MARKERS.some(m => buf.toLowerCase().includes(m));

    // Standalone artifact poller — used when execution.lock is already present and
    // we should not spawn a second execution, only wait for results to appear.
    const pollArtifacts = (timeoutMs: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        let done = false;
        let pollTimer: ReturnType<typeof setInterval>;
        let timeoutHandle: ReturnType<typeof setTimeout>;
        const teardown = () => { clearInterval(pollTimer); clearTimeout(timeoutHandle); };
        const check = async () => {
          if (done) return;
          try {
            const raw = await fs.readFile(testResultsPath, "utf-8");
            const parsed = JSON.parse(raw);
            const count = Array.isArray(parsed)
              ? parsed.length
              : (parsed?.tests?.length ?? parsed?.summary?.total ?? 0);
            if (count > 0) {
              done = true; teardown();
              this.log(`> test_results.json appeared with ${count} test entries.`);
              resolve(); return;
            }
          } catch { /* not ready */ }
          for (const p of artifactPaths.slice(1)) {
            try {
              await fs.access(p);
              done = true; teardown();
              this.log(`> Result artifact found: ${path.basename(p)}`);
              resolve(); return;
            } catch { /* not ready */ }
          }
        };
        pollTimer    = setInterval(check, 2000);
        timeoutHandle = setTimeout(() => {
          if (!done) {
            done = true; teardown();
            reject(new Error("Execution stayed locked but did not produce result artifacts."));
          }
        }, timeoutMs);
        check(); // immediate first check
      });

    // ── Check for existing execution.lock ──────────────────────────────
    // If another execution is already running (e.g. auto-opened browser tab started
    // TestSprite independently), skip spawning a second process and just wait for its
    // artifacts instead.
    const lockPath = path.join(tmpDir, "execution.lock");
    const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
    if (lockExists) {
      this.log(`> Execution already in progress (execution.lock found). Waiting for result artifacts...`);
      await pollArtifacts(60_000);
      return;
    }

    const runCmd = (cmd: string): Promise<void> => {
      this.log(`> next_action terminal command:`);
      this.log(`  ${cmd}`);

      return new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, [], {
          cwd: projectPath,
          shell: true,
          // CI=1, BROWSER=none, TESTSPRITE_NO_OPEN=1 suppress any automatic browser-open behaviour
          env: { ...process.env, ...extraEnv, BROWSER: "none", CI: "1", TESTSPRITE_NO_OPEN: "1", TESTSPRITE_NO_OPEN_BROWSER: "1", NO_OPEN: "1" },
        });

        let stdoutBuf = "";
        let stderrBuf = "";
        let settled = false;
        let markerSeen = false;
        let artifactPollTimer: ReturnType<typeof setInterval> | null = null;
        let artifactTimeout: ReturnType<typeof setTimeout> | null = null;
        let hardTimeout: ReturnType<typeof setTimeout> | null = null;

        const killChild = () => {
          try { child.kill("SIGTERM"); } catch {}
          setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
        };

        const succeed = (reason: string) => {
          if (settled) return;
          settled = true;
          if (artifactPollTimer) clearInterval(artifactPollTimer);
          if (artifactTimeout) clearTimeout(artifactTimeout);
          if (hardTimeout) clearTimeout(hardTimeout);
          this.log(`> ${reason}`);
          this.log(`> Terminating lingering execution process...`);
          killChild();
          resolve();
        };

        const fail = (reason: string) => {
          if (settled) return;
          settled = true;
          if (artifactPollTimer) clearInterval(artifactPollTimer);
          if (artifactTimeout) clearTimeout(artifactTimeout);
          if (hardTimeout) clearTimeout(hardTimeout);
          killChild();
          reject(new Error(reason));
        };

        // Checks all artifact paths; resolves the promise if any valid artifact is found
        const checkArtifacts = async (): Promise<void> => {
          if (settled) return;
          try {
            const raw = await fs.readFile(testResultsPath, "utf-8");
            const parsed = JSON.parse(raw);
            const count = Array.isArray(parsed)
              ? parsed.length
              : (parsed?.tests?.length ?? parsed?.summary?.total ?? 0);
            if (count > 0) { succeed(`test_results.json appeared with ${count} test entries.`); return; }
          } catch { /* not ready */ }
          for (const p of artifactPaths.slice(1)) {
            try { await fs.access(p); succeed(`Result artifact found: ${path.basename(p)}`); return; }
            catch { /* not ready */ }
          }
        };

        // Called once success marker or clean exit is observed.
        // Does NOT kill the process — waits up to 45 s for artifacts to appear first.
        const startArtifactPolling = () => {
          if (artifactPollTimer) return; // already started
          this.log(`> Waiting for result artifacts...`);
          artifactPollTimer = setInterval(checkArtifacts, 2000);
          artifactTimeout = setTimeout(() => {
            if (!settled) fail("Test execution completed, but result artifacts were not produced.");
          }, 45_000);
        };

        child.stdout?.on("data", (data: Buffer) => {
          const str = data.toString();
          stdoutBuf += str;
          for (const line of str.split("\n")) {
            const t = line.trimEnd();
            if (t) this.log(t);
          }
          if (!markerSeen && checkMarkers(stdoutBuf)) {
            markerSeen = true;
            this.log(`> Success marker detected - waiting for result artifacts...`);
            startArtifactPolling();
          }
        });

        child.stderr?.on("data", (data: Buffer) => {
          const str = data.toString();
          stderrBuf += str;
          for (const line of str.split("\n")) {
            const t = line.trimEnd();
            if (t) this.log(`[stderr] ${t}`);
          }
        });

        child.on("exit", (code: number | null) => {
          if (settled) return;
          if (code === 0 || code === null) {
            // Clean exit - wait for artifacts whether or not marker was seen
            if (!markerSeen) this.log(`> Process exited cleanly, checking for artifacts...`);
            startArtifactPolling();
          } else if (markerSeen) {
            // Marker already seen; artifact polling is running - let it continue
          } else {
            fail(
              `next_action terminal command failed (exit code ${code}).\n` +
              `Command: ${cmd.slice(0, 400)}\n` +
              (stderrBuf.trim()
                ? `stderr: ${stderrBuf.slice(0, 2000)}`
                : stdoutBuf.trim()
                ? `stdout: ${stdoutBuf.slice(0, 2000)}`
                : "(no output)")
            );
          }
        });

        child.on("error", (err: Error) => {
          fail(`next_action process spawn error: ${err.message}`);
        });

        // Hard timeout after 10 minutes
        hardTimeout = setTimeout(() => {
          if (settled) return;
          if (markerSeen) {
            fail("Test execution completed, but result artifacts were not produced (hard timeout).");
          } else {
            fail("next_action command timed out after 10 minutes with no success markers or result file.");
          }
        }, 600_000);
      });
    };

    // Prefer structured next_action JSON: { next_action: [{ type, tool, input }] }
    let structuredActions: any[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.next_action)) structuredActions = parsed.next_action;
    } catch { /* not top-level JSON — fall through */ }

    if (structuredActions.length > 0) {
      for (const action of structuredActions) {
        if (action.type === "tool" && action.tool === "Run in Terminal" && action.input?.command) {
          await runCmd(action.input.command);
        }
      }
      return;
    }

    // Fallback: extract first bash code block from response text
    const match = text.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
    if (match) await runCmd(match[1].trim());
  }

  private extractText(result: any): string {
    if (!result?.content) return "";
    return result.content.map((c: any) => c.text || "").join("") || "";
  }

  cleanup() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    if (this.proxyServer) {
      this.proxyServer.close();
      this.proxyServer = null;
    }
  }
}
