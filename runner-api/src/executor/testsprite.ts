// TestSpriteApp — ported from lib/testsprite-mcp.ts for the Railway runner.
// No Next.js dependencies; pure Node.js.
import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";
import * as https from "https";

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
  private pendingRequests = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();
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
      throw new Error(
        "TestSprite authentication failed. Please configure a valid TESTSPRITE_API_KEY."
      );
    }
  }

  async start(options: RunTestSpriteOptions) {
    const {
      projectPath,
      targetUrl,
      apiKey,
      projectName,
      additionalInstruction,
      needLogin = false,
      projectDescription = "",
    } = options;

    // 1. Resolve local endpoint — skip proxy for local dev servers
    let localEndpoint: string;
    if (
      targetUrl &&
      !targetUrl.includes("localhost") &&
      !targetUrl.includes("127.0.0.1")
    ) {
      const proxyPort = await this.startProxy(targetUrl);
      localEndpoint = `http://localhost:${proxyPort}/`;
      this.log(`Proxying ${targetUrl} → ${localEndpoint}`);
    } else {
      localEndpoint = targetUrl.endsWith("/") ? targetUrl : `${targetUrl}/`;
    }

    // 2. Pre-create workspace structure + synthetic PRD
    await this.createConfig(
      projectPath,
      localEndpoint,
      projectName,
      apiKey,
      projectDescription,
      additionalInstruction ?? ""
    );

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
        shell: false,
      }
    );

    let buffer = "";
    this.child.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as any;
          if (msg.error) {
            const errStr = JSON.stringify(msg.error).toLowerCase();
            if (
              errStr.includes("auth") ||
              errStr.includes("unauthorized") ||
              errStr.includes("invalid_key") ||
              errStr.includes("api_key")
            ) {
              (this as any)._authError = true;
            }
            if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
              const { reject } = this.pendingRequests.get(msg.id)!;
              this.pendingRequests.delete(msg.id);
              reject(new Error(`MCP tool error: ${JSON.stringify(msg.error)}`));
              return;
            }
          }
          if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
            const { resolve } = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            resolve(msg.result);
          }
        } catch {
          // non-JSON line — ignore
        }
      }
    });

    this.child.stderr?.on("data", (data: Buffer) => {
      const str = data.toString();
      this.log(`[MCP stderr] ${str.trim().slice(0, 300)}`);
      if (
        str.includes("AUTH_FAILED") ||
        str.includes("mcp_terminate") ||
        str.includes("Unauthorized") ||
        str.includes("Invalid API key") ||
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

    // ── Pre-flight: validate workspace structure ──────────────────────────
    const configPath = path.join(tmpDir, "config.json");
    const prdFilesCheck = path.join(tmpDir, "prd_files");
    try {
      await fs.stat(configPath);
      this.log(`config.json found → ${configPath}`);
    } catch {
      throw new Error("config.json missing — workspace setup failed before MCP start.");
    }
    try {
      await fs.stat(prdFilesCheck);
      this.log(`prd_files/ found → ${prdFilesCheck}`);
    } catch {
      throw new Error("prd_files/ missing — workspace setup failed before MCP start.");
    }

    // ── Stage 1: Code Summary ─────────────────────────────────────────────
    this.setStage("Generate code summary");
    this.log("Analyzing codebase...");
    const codeSummaryRes = await this.callTool(
      "testsprite_generate_code_summary",
      { projectRootPath: projectPath }
    );
    this.checkAuth();

    const codeSummaryText = this.extractText(codeSummaryRes);
    const codeSummaryPath = path.join(tmpDir, "code_summary.json");
    if (codeSummaryText && codeSummaryText.trim().length > 20) {
      await fs.writeFile(codeSummaryPath, codeSummaryText);
      this.log(`code_summary.json written → ${codeSummaryPath}`);
      await fs.writeFile(path.join(tmpDir, "code_summary.yaml"), codeSummaryText);
    } else {
      const selfWritten =
        (await fs.stat(codeSummaryPath).then(() => true).catch(() => false)) ||
        (await fs.stat(path.join(tmpDir, "code_summary.yaml")).then(() => true).catch(() => false));
      if (selfWritten) {
        this.log("code_summary already on disk (written by tool).");
      } else {
        throw new Error(
          "[Stage 1] testsprite_generate_code_summary returned no content and code_summary.json was not written."
        );
      }
    }

    // ── Stage 2: Standardized PRD ─────────────────────────────────────────
    this.setStage("Generate PRD");
    this.log("Generating PRD...");
    const prdRes = await this.callTool("testsprite_generate_standardized_prd", {
      projectPath,
    });
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

    // ── Stage 3: Test Plan ────────────────────────────────────────────────
    this.setStage("Generate test plan");
    this.log("Generating Test Plan...");
    const testPlanRes = await this.callTool(
      "testsprite_generate_frontend_test_plan",
      {
        projectPath,
        needLogin,
        // Seed coverage guidance upstream so the planner generates 8-12 cases
        additionalInstruction: additionalInstruction ?? "",
      }
    );
    this.checkAuth();

    const testPlanText = this.extractText(testPlanRes);

    // The generateCodeAndExecute CLI binary reads this exact path — if the file
    // is missing it crashes with ENOENT before running any tests.
    const testPlanJsonPath = path.join(projectPath, "testsprite_tests", "testsprite_frontend_test_plan.json");
    await fs.mkdir(path.join(projectPath, "testsprite_tests"), { recursive: true });

    if (testPlanText && testPlanText.trim().length > 20) {
      // Save the raw response as markdown for debugging
      await fs.writeFile(path.join(tmpDir, "test_plan.md"), testPlanText);
      this.log(`Test plan (markdown) saved → ${path.join(tmpDir, "test_plan.md")}`);
    } else {
      this.log("Test plan tool returned no content (non-fatal, continuing).");
    }

    // Only write if not already self-written by the MCP tool
    const planAlreadyExists = await fs.access(testPlanJsonPath).then(() => true).catch(() => false);
    if (!planAlreadyExists) {
      // Try to extract a JSON array from the tool response (it often returns one)
      let planJson: unknown = null;
      if (testPlanText) {
        // Match a top-level JSON array anywhere in the response
        const jsonMatch = testPlanText.match(/(\[[\s\S]*\])/);
        if (jsonMatch) {
          try { planJson = JSON.parse(jsonMatch[1]); } catch { /* not valid JSON */ }
        }
        if (!planJson) {
          try { planJson = JSON.parse(testPlanText.trim()); } catch { /* not JSON */ }
        }
      }

      if (Array.isArray(planJson) && (planJson as unknown[]).length > 0) {
        await fs.writeFile(testPlanJsonPath, JSON.stringify(planJson, null, 2));
        this.log(`Test plan JSON saved → ${testPlanJsonPath} (${(planJson as unknown[]).length} cases)`);
      } else {
        // Fallback: write a minimal plan so the CLI can boot and generate its own tests
        const fallbackPlan = [
          {
            id: "TC001",
            title: "Initial application load and core user flows",
            description: "Verify the application loads correctly and primary user interactions work end-to-end.",
            category: "General",
            priority: "High",
            steps: [
              { type: "action",    description: "Navigate to the root of the application" },
              { type: "assertion", description: "Verify the page renders without errors" },
              { type: "action",    description: "Interact with the primary call-to-action" },
              { type: "assertion", description: "Verify the expected result of the interaction is visible" },
            ],
          },
        ];
        await fs.writeFile(testPlanJsonPath, JSON.stringify(fallbackPlan, null, 2));
        this.log(`Test plan JSON (fallback) saved → ${testPlanJsonPath}`);
      }
    } else {
      this.log(`Test plan JSON already on disk → ${testPlanJsonPath}`);
    }

    // ── Stage 4: Generate & Execute ───────────────────────────────────────
    this.setStage("Generate and execute tests");
    this.log("Generating and executing tests...");
    const executeRes = await this.callTool(
      "testsprite_generate_code_and_execute",
      {
        projectName,
        projectPath,
        testIds: [],
        additionalInstruction: additionalInstruction ?? "",
        serverMode: "development",
      },
      600_000
    );
    this.checkAuth();

    const executeText = this.extractText(executeRes);
    this.log(`Execute response length: ${executeText.length} chars`);
    if (executeText.trim().length > 0) {
      this.log(`Execute response preview: ${executeText.slice(0, 400)}`);
    }

    await this.processNextActions(executeRes, projectPath, {
      ...process.env,
      TESTSPRITE_API_KEY: apiKey,
      API_KEY: apiKey,
    });

    // ── Finalize & validate results ───────────────────────────────────────
    this.setStage("Finalize results");
    const testResultsPath = path.join(tmpDir, "test_results.json");

    const testResultsExists = await fs
      .stat(testResultsPath)
      .then(() => true)
      .catch(() => false);
    if (!testResultsExists) {
      throw new Error(
        "TestSprite execution did not produce test_results.json. " +
          "The app may not have been accessible to Playwright, or test generation failed."
      );
    }

    let rawTestResults: unknown;
    try {
      rawTestResults = JSON.parse(await fs.readFile(testResultsPath, "utf-8"));
    } catch {
      throw new Error("test_results.json could not be parsed — the file may be malformed or empty.");
    }
    const testCount = Array.isArray(rawTestResults)
      ? rawTestResults.length
      : ((rawTestResults as any)?.tests?.length ??
          (rawTestResults as any)?.summary?.total ??
          0);
    if (testCount === 0) {
      throw new Error(
        "test_results.json was generated but contains no test entries. " +
          "TestSprite could not execute any tests against the application."
      );
    }
    this.log(`test_results.json valid — ${testCount} test entries found.`);

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

    let results: unknown = null;
    for (const p of resultCandidates) {
      try {
        results = JSON.parse(await fs.readFile(p, "utf-8"));
        break;
      } catch { /* try next */ }
    }
    let report = "";
    for (const p of reportCandidates) {
      try {
        const s = await fs.readFile(p, "utf-8");
        if (s) { report = s; break; }
      } catch { /* try next */ }
    }

    this.cleanup();
    return { results, report };
  }

  // ── Config writer ───────────────────────────────────────────────────────────

  private async createConfig(
    projectPath: string,
    localEndpoint: string,
    projectName: string,
    apiKey: string,
    projectDescription: string,
    additionalInstruction: string = ""
  ) {
    const testspriteDir = path.join(projectPath, "testsprite_tests", "tmp");
    await fs.mkdir(testspriteDir, { recursive: true });

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
      "- Navigation, routing, and page transitions",
      "- User-facing flows: forms, CTAs, data submission, and feedback",
      "- Loading, error, and empty states for async operations",
      "- Responsive layout across common viewport sizes",
      "",
      "## Test Objectives",
      "- Identify broken or incomplete user-facing functionality a contributor could fix",
      "- Generate 8 to 12 meaningful tests covering the breadth of the application",
      "- Cover: initial render, navigation, core CTA flows, form validation, empty/error states, modals, dropdowns, and responsiveness",
      "- Avoid shallow presence checks — prefer realistic user journeys that exercise real state transitions",
      "- For every failing test, capture what the user attempted, what was expected, what actually happened, and which area of the UI is involved",
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
        // Write the real instruction into the stored config so TestSprite's own
        // test planner reads it when deciding how many test cases to generate.
        additionalInstruction,
        serverMode: "development",
        envs: { API_KEY: apiKey },
      },
    };
    await fs.writeFile(
      path.join(testspriteDir, "config.json"),
      JSON.stringify(config, null, 2)
    );
  }

  // ── HTTP proxy for remote targets ───────────────────────────────────────────

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
        proxy.on("error", () => {
          res.writeHead(502);
          res.end("Bad Gateway");
        });
        req.pipe(proxy);
      });
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as any)?.port as number;
        this.proxyServer = server;
        resolve(port);
      });
    });
  }

  // ── JSON-RPC helpers ────────────────────────────────────────────────────────

  private sendRequest(method: string, params: object, timeoutMs = 300_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin) return reject(new Error("MCP process not running"));
      const id = this.messageCounter++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`MCP request timed out after ${timeoutMs / 1000}s (method=${method})`)
        );
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.child.stdin.write(msg + "\n");
    });
  }

  private sendNotification(method: string, params: object): void {
    if (!this.child?.stdin) return;
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.child.stdin.write(msg + "\n");
  }

  private callTool(name: string, args: object, timeoutMs = 300_000): Promise<unknown> {
    return this.sendRequest("tools/call", { name, arguments: args }, timeoutMs);
  }

  // ── next_action terminal command runner ─────────────────────────────────────

  private async processNextActions(
    result: unknown,
    projectPath: string,
    extraEnv: Record<string, string | undefined> = {}
  ): Promise<void> {
    const text = this.extractText(result);
    const tmpDir = path.join(projectPath, "testsprite_tests", "tmp");
    const testResultsPath = path.join(tmpDir, "test_results.json");
    const artifactPaths = [
      testResultsPath,
      path.join(projectPath, "TestSprite_MCP_Test_Report.md"),
      path.join(projectPath, "TestSprite_MCP_Test_Report.html"),
      path.join(tmpDir, "TestSprite_MCP_Test_Report.md"),
      path.join(tmpDir, "TestSprite_MCP_Test_Report.html"),
    ];

    const SUCCESS_MARKERS = ["test execution completed", "execution lock released"];
    const checkMarkers = (buf: string) =>
      SUCCESS_MARKERS.some((m) => buf.toLowerCase().includes(m));

    const pollArtifacts = (timeoutMs: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        let done = false;
        const pollTimer = setInterval(check, 2000);
        const timeoutHandle = setTimeout(() => {
          if (!done) {
            done = true;
            clearInterval(pollTimer);
            reject(new Error("Execution stayed locked but did not produce result artifacts."));
          }
        }, timeoutMs);
        async function check() {
          if (done) return;
          try {
            const raw = await fs.readFile(testResultsPath, "utf-8");
            const parsed = JSON.parse(raw);
            const count = Array.isArray(parsed)
              ? parsed.length
              : (parsed?.tests?.length ?? parsed?.summary?.total ?? 0);
            if (count > 0) {
              done = true;
              clearInterval(pollTimer);
              clearTimeout(timeoutHandle);
              resolve();
              return;
            }
          } catch { /* not ready */ }
          for (const p of artifactPaths.slice(1)) {
            try {
              await fs.access(p);
              done = true;
              clearInterval(pollTimer);
              clearTimeout(timeoutHandle);
              resolve();
              return;
            } catch { /* not ready */ }
          }
        }
        check();
      });

    const lockPath = path.join(tmpDir, "execution.lock");
    const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
    if (lockExists) {
      this.log("> Execution already in progress (lock found). Waiting for artifacts...");
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
          env: {
            ...process.env,
            ...extraEnv,
            BROWSER: "none",
            CI: "1",
            TESTSPRITE_NO_OPEN: "1",
            TESTSPRITE_NO_OPEN_BROWSER: "1",
            NO_OPEN: "1",
          },
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

        const checkArtifacts = async () => {
          if (settled) return;
          try {
            const raw = await fs.readFile(testResultsPath, "utf-8");
            const parsed = JSON.parse(raw);
            const count = Array.isArray(parsed)
              ? parsed.length
              : (parsed?.tests?.length ?? parsed?.summary?.total ?? 0);
            if (count > 0) { succeed(`test_results.json appeared with ${count} entries.`); return; }
          } catch { /* not ready */ }
          for (const p of artifactPaths.slice(1)) {
            try { await fs.access(p); succeed(`Result artifact found: ${path.basename(p)}`); return; }
            catch { /* not ready */ }
          }
        };

        const startArtifactPolling = () => {
          if (artifactPollTimer) return;
          this.log(`> Waiting for result artifacts...`);
          artifactPollTimer = setInterval(checkArtifacts, 2000);
          artifactTimeout = setTimeout(() => {
            if (!settled)
              fail("Test execution completed, but result artifacts were not produced.");
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
            this.log(`> Success marker detected — waiting for artifacts...`);
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
            startArtifactPolling();
          } else if (markerSeen) {
            // artifact polling already running — let it continue
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

        hardTimeout = setTimeout(() => {
          if (settled) return;
          if (markerSeen) {
            fail("Test execution completed, but result artifacts were not produced (hard timeout).");
          } else {
            fail("next_action command timed out after 10 minutes with no success markers.");
          }
        }, 600_000);
      });
    };

    // Prefer structured next_action JSON
    let structuredActions: any[] = [];
    try {
      const parsed = JSON.parse(text) as any;
      if (Array.isArray(parsed?.next_action)) structuredActions = parsed.next_action;
    } catch { /* not top-level JSON */ }

    if (structuredActions.length > 0) {
      for (const action of structuredActions) {
        if (
          action.type === "tool" &&
          action.tool === "Run in Terminal" &&
          action.input?.command
        ) {
          await runCmd(action.input.command as string);
        }
      }
      return;
    }

    // Fallback: extract first bash code block from response text
    const match = text.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
    if (match) await runCmd(match[1].trim());
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  private extractText(result: unknown): string {
    if (!result || typeof result !== "object") return "";
    const r = result as any;
    if (!r.content) return "";
    return (r.content as any[]).map((c: any) => c.text ?? "").join("") ?? "";
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
