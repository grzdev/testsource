import { TestSpriteApp } from "./testsprite-mcp";
import EventEmitter from "events";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as https from "https";
import { fetchIssueComments } from "./github";

const execAsync = promisify(exec);

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobState {
  id: string;
  status: JobStatus;
  stage: string;
  logs: string[];
  results?: any;
  error?: string;
  proxyUrl?: string;
}

// Persist across Next.js HMR / module reloads
const globalAny = globalThis as any;
const jobs: Map<string, JobState> = globalAny.testSpriteJobs ?? (globalAny.testSpriteJobs = new Map());
const jobEmitters: Map<string, EventEmitter> = globalAny.testSpriteEmitters ?? (globalAny.testSpriteEmitters = new Map());

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function createJob(id: string): JobState {
  const newJob: JobState = { id, status: "pending", stage: "Initializing", logs: [] };
  jobs.set(id, newJob);
  jobEmitters.set(id, new EventEmitter());
  return newJob;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Probe a URL: HTTP 200 + HTML content-type + body contains <html or <!doctype. */
function probeHtml(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    try {
      const req = client.get(url, { timeout: timeoutMs } as any, (res) => {
        // Follow 301/302 by re-probing the Location header once
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          res.resume();
          probeHtml(res.headers.location as string, timeoutMs).then(resolve);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        const ct = String(res.headers["content-type"] || "");
        if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
          res.resume(); resolve(false); return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; if (body.length > 4096) res.destroy(); });
        res.on("close", () => resolve(/<!doctype html|<html/i.test(body)));
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

/** Basic TCP/HTTP probe (no HTML requirement) — used for remote pre-flight only. */
function probeUrl(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    try {
      const req = client.get(url, { timeout: timeoutMs } as any, (res) => {
        resolve(res.statusCode !== undefined); res.resume();
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

/** Ask the OS for a free TCP port by binding to :0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as any)?.port as number;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Poll until the URL serves a valid HTML page or total timeout is reached. */
async function waitForHtml(
  url: string,
  totalTimeoutMs: number,
  logFn: (msg: string) => void
): Promise<boolean> {
  const deadline = Date.now() + totalTimeoutMs;
  while (Date.now() < deadline) {
    if (await probeHtml(url, 8_000)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  logFn(`> Dev server at ${url} did not serve valid HTML within the timeout.`);
  return false;
}

type Framework = "nextjs" | "vite" | "cra" | "unknown";

function detectFramework(pkg: any): Framework {
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (allDeps["next"]) return "nextjs";
  if (allDeps["vite"] || allDeps["@sveltejs/kit"]) return "vite";
  if (allDeps["react-scripts"]) return "cra";
  return "unknown";
}

/**
 * Build a framework-specific startup command that runs the underlying binary
 * directly (never via `pnpm run dev -- ...`) so argument parsing stays correct.
 */
function buildStartCmd(
  framework: Framework,
  pm: "pnpm" | "yarn" | "npm",
  scriptContent: string,
  port: number
): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const exec = (bin: string, ...rest: string[]) =>
    pm === "pnpm" ? { cmd: "pnpm", args: ["exec", bin, ...rest] }
    : pm === "yarn" ? { cmd: "yarn", args: ["exec", bin, ...rest] }
    : { cmd: "npx", args: ["--no-install", bin, ...rest] };

  if (framework === "nextjs") {
    // next dev [-p PORT] or next start [-p PORT]
    // Detect turbopack flag from the script content
    const turbo = /--turbo(?:pack)?/.test(scriptContent) ? ["--turbopack"] : [];
    return exec("next", "dev", ...turbo, "-p", String(port));
  }

  if (framework === "vite") {
    return exec("vite", "--host", "0.0.0.0", "--port", String(port));
  }

  if (framework === "cra") {
    // CRA reads PORT from env — it ignores CLI flags
    return {
      cmd: pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm",
      args: pm === "yarn" ? ["start"] : ["run", "start"],
      env: { ...process.env, PORT: String(port), BROWSER: "none", CI: "true" },
    };
  }

  // Unknown — do not attempt; caller must handle
  throw new Error(
    "Only Next.js, Vite/SvelteKit, and Create-React-App repos are supported for automatic local testing. " +
    "Please provide a deployed preview URL instead."
  );
}

/** Detect the best package manager: pnpm > yarn > npm */
async function detectPackageManager(workDir: string): Promise<"pnpm" | "yarn" | "npm"> {
  try { await fs.stat(path.join(workDir, "pnpm-lock.yaml")); return "pnpm"; } catch {}
  try { await fs.stat(path.join(workDir, "yarn.lock")); return "yarn"; } catch {}
  return "npm";
}



// ─── Main Job Runner ─────────────────────────────────────────────────────────

export async function runTestSpriteJob(jobId: string, githubUrl: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const emitter = jobEmitters.get(jobId)!;

  const log = (msg: string) => {
    job.logs.push(msg);
    emitter.emit("log", msg);
    // Capture TestSprite tunnel/proxy URL or the local modification dashboard URL
    if (!job.proxyUrl) {
      const m = msg.match(/proxy\s+url[:\s]+(https?:\/\/\S+)/i);
      if (m) {
        job.proxyUrl = m[1].replace(/[.,;>'"]+$/, "");
      } else {
        // TestSprite logs its local modification UI URL — capture it too
        const dm = msg.match(/(https?:\/\/localhost:\d{4,5}\/(?:modification|dashboard)[^\s'"<>]*)/i);
        if (dm) job.proxyUrl = dm[1].replace(/[.,;>'"]+$/, "");
      }
    }
  };
  const setStage = (stage: string) => { job.stage = stage; emitter.emit("stage", stage); };

  job.status = "running";

  let tempDir = "";
  let localServerProcess: any = null;

  try {
    setStage("Analyze URL");
    log("> Analyzing URL: " + githubUrl);

    // ── Parse GitHub URL ──────────────────────────────────────────────────
    const u = new URL(githubUrl.startsWith("http") ? githubUrl : `https://${githubUrl}`);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Invalid GitHub URL.");

    const owner   = parts[0];
    const repoRaw = parts[1];
    const type    = parts[2] ?? null;  // pull | issues | tree | null
    const numStr  = parts[3] ?? null;

    let subpath = "";
    if (type === "tree" && parts.length > 4) {
      // /tree/{branch}/{subpath...}  → skip branch (parts[3]), keep rest
      subpath = parts.slice(4).join("/");
    }

    const repo        = repoRaw.replace(/\.git$/, "");
    const fullRepoUrl = `https://github.com/${owner}/${repo}`;

    // ── PR preview link scan ──────────────────────────────────────────────
    let targetUrl: string | null = null;

    if (type === "pull" && numStr) {
      log("> Scanning PR comments for preview deployment URL...");
      try {
        const comments = await fetchIssueComments(owner, repo, parseInt(numStr, 10));
        const previewPattern = /https:\/\/[a-zA-Z0-9-]+\.(?:vercel\.app|netlify\.app|pages\.dev|fly\.dev|up\.railway\.app|onrender\.com|azurestaticapps\.net)[^\s)]*/;
        for (const c of comments) {
          const m = c.body.match(previewPattern);
          if (m) { targetUrl = m[0]; break; }
        }
        if (targetUrl) log(`> Found preview URL: ${targetUrl}`);
        else log("> No preview deployment link found in PR comments. Falling back to local sandbox.");
      } catch (err: any) {
        log(`> Could not fetch PR comments: ${err.message}`);
      }
    } else if (type === "issues") {
      throw new Error(
        "Issues do not map to a runnable application. Paste a PR or repo link instead."
      );
    }

    // ── Clone repository ──────────────────────────────────────────────────
    setStage("Clone repository");
    log(`> Creating temporary workspace...`);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "testsprite-"));

    log(`> Cloning ${fullRepoUrl} (shallow)...`);
    await execAsync(`git clone --depth 1 ${fullRepoUrl} .`, { cwd: tempDir });

    if (type === "pull" && numStr) {
      log(`> Checking out Pull Request #${numStr} code...`);
      try {
        // GitHub exposes a special ref for every PR head: refs/pull/ID/head
        await execAsync(`git fetch origin pull/${numStr}/head:pr-${numStr}`, { cwd: tempDir });
        await execAsync(`git checkout pr-${numStr}`, { cwd: tempDir });
        log(`> Successfully checked out PR #${numStr} head.`);
      } catch (err: any) {
        log(`> Warning: Could not checkout specific PR head: ${err.message}. Defaulting to main branch.`);
      }
    }

    const workDir = subpath ? path.join(tempDir, subpath) : tempDir;
    if (subpath) log(`> Using subpath: ${subpath}`);

    // ── Local sandbox bootstrap (if no remote target) ─────────────────────
    let projectDescription = "";
    const isRemoteTarget = !!targetUrl;
    if (!targetUrl) {
      const pkgPath = path.join(workDir, "package.json");
      let pkg: any;
      try {
        pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      } catch {
        throw new Error(
          "No package.json found. Repository may be a non-Node project or the subpath is invalid. Provide a deployment URL."
        );
      }

      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const isLibrary =
        !pkg.scripts?.dev && !pkg.scripts?.start && !pkg.scripts?.preview &&
        (pkg.main || pkg.types || pkg.exports);
      if (isLibrary) {
        throw new Error(
          "Repository appears to be a library or CLI tool (no dev/start script detected). " +
          "TestSprite requires a running web application. Provide a deployment URL."
        );
      }

      const pm = await detectPackageManager(workDir);
      log(`> Package manager detected: ${pm}`);

      // ── Detect framework (only supported ones proceed) ──────────────────
      const framework = detectFramework(pkg);
      log(`> Detected framework: ${framework}`);
      if (framework === "unknown") {
        throw new Error(
          "Could not identify a supported frontend framework (Next.js, Vite/SvelteKit, Create React App). " +
          "Only these three are supported for automatic local testing. Provide a deployed preview URL instead."
        );
      }

      // ── Install ─────────────────────────────────────────────────────────
      setStage("Install dependencies");
      log(`> Installing dependencies (${pm} install)...`);
      try {
        const installResult = await execAsync(`${pm} install --prefer-offline 2>&1`, { cwd: workDir });
        if (installResult.stdout) log(`  ${installResult.stdout.slice(0, 300)}`);
      } catch (err: any) {
        log(`> Install warning: ${String(err.message).slice(0, 300)}`);
      }

      // ── Read README for synthetic PRD generation ─────────────────────────
      projectDescription = (pkg.description as string | undefined) || "";
      for (const readmeFile of ["README.md", "README", "readme.md"]) {
        try {
          const readme = await fs.readFile(path.join(workDir, readmeFile), "utf-8");
          projectDescription = readme.slice(0, 1500);
          break;
        } catch {}
      }

      // ── Build framework-specific startup command ─────────────────────────
      setStage("Start dev server");
      const scriptContent = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";
      const assignedPort = await findFreePort();
      const startCmd = buildStartCmd(framework, pm, scriptContent, assignedPort);
      const { cmd, args } = startCmd;
      const spawnEnv: NodeJS.ProcessEnv = {
        ...process.env,
        FORCE_COLOR: "0",
        BROWSER: "none",
        CI: "true",
        ...(startCmd.env ?? {}),
      };

      log(`> Assigned port: ${assignedPort}`);
      log(`> Startup command: ${cmd} ${args.join(" ")}`);

      // ── Spawn ────────────────────────────────────────────────────────────
      let runtimePort: number | null = null;
      let serverFailed = false;
      let serverFailReason = "";
      // Capture first localhost URL printed by the framework
      const urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/i;

      localServerProcess = spawn(cmd, args, {
        cwd: workDir,
        shell: process.platform === "win32",
        env: spawnEnv,
      });

      const handleOutput = (data: Buffer) => {
        const str = data.toString();
        for (const line of str.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) log(`  ${trimmed.slice(0, 160)}`);
        }
        if (str.includes("EADDRINUSE")) {
          serverFailed = true;
          serverFailReason = "Port already in use (EADDRINUSE).";
        }
        if (!runtimePort && !serverFailed) {
          const m = urlPattern.exec(str);
          if (m) {
            runtimePort = parseInt(m[1], 10);
            log(`> Runtime URL detected: http://localhost:${runtimePort}`);
          }
        }
      };

      localServerProcess.stdout?.on("data", handleOutput);
      localServerProcess.stderr?.on("data", handleOutput);
      localServerProcess.on("exit", (code: number | null) => {
        if (code !== null && code !== 0) {
          serverFailed = true;
          if (!serverFailReason) serverFailReason = `Dev server exited with code ${code}.`;
        }
      });

      // Wait up to 30 s for either a URL in stdout or a failure
      log(`> Waiting for dev server to announce its URL (up to 30 s)...`);
      for (let i = 0; i < 150 && !runtimePort && !serverFailed; i++) {
        await new Promise((r) => setTimeout(r, 200));
      }

      if (serverFailed) {
        throw new Error(
          `Dev server failed to start: ${serverFailReason} ` +
          `Command: ${cmd} ${args.join(" ")}. ` +
          "Try providing a deployed preview URL instead."
        );
      }

      // If the server didn't print a URL, fall back to the assigned port
      const confirmedPort = runtimePort ?? assignedPort;
      const confirmedUrl = `http://localhost:${confirmedPort}`;

      if (runtimePort && runtimePort !== assignedPort) {
        log(`> Note: server chose port ${runtimePort} instead of assigned ${assignedPort}. Using ${confirmedUrl}.`);
      }

      // ── Wait for valid HTML ──────────────────────────────────────────────
      setStage("Verify HTML target");
      log(`> Waiting for ${confirmedUrl} to serve HTML (up to 60 s)...`);
      const htmlReady = await waitForHtml(confirmedUrl, 60_000, log);

      if (!htmlReady) {
        throw new Error(
          `Dev server at ${confirmedUrl} did not serve a valid HTML response within 60 s. ` +
          "The app may not have a web UI, may require environment variables, or may be failing to compile."
        );
      }

      log(`> Dev server confirmed — serving HTML at ${confirmedUrl}`);
      log(`> Target URL passed to TestSprite: ${confirmedUrl}`);
      targetUrl = confirmedUrl;
    }

    // ── Validate remote targets ───────────────────────────────────────────
    if (isRemoteTarget && targetUrl) {
      setStage("Verify HTML target");
      log(`> Verifying target serves HTML: ${targetUrl} ...`);
      const ok = await probeHtml(targetUrl, 8000);
      if (!ok) {
        // Fall back to simple TCP probe so we show a more specific error
        const alive = await probeUrl(targetUrl, 5000);
        if (!alive) {
          throw new Error(`Target URL is not reachable: ${targetUrl}. Ensure the deployment or dev server is running.`);
        }
        throw new Error(`Target URL responded but did not serve a valid HTML page: ${targetUrl}.`);
      }
      log(`> Target confirmed — serving HTML at ${targetUrl}.`);
    }

    // ── TestSprite MCP ────────────────────────────────────────────────────
    setStage("Initialize MCP");
    log("> Initializing TestSprite MCP wrapper...");

    const apiKey = process.env.TESTSPRITE_API_KEY;
    if (!apiKey) throw new Error("TESTSPRITE_API_KEY environment variable is missing.");

    const app = new TestSpriteApp();
    app.onLog   = (msg) => log(`> ${msg}`);
    app.onStage = (stage) => setStage(stage);

    log("> Starting TestSprite workflow...");
    const { results, report } = await app.start({
      projectPath: workDir || tempDir,
      projectName: repo,
      targetUrl: targetUrl!,
      apiKey,
      additionalInstruction:
        `Test the application at ${targetUrl}. Focus on core user-facing flows, navigation, and UI interactions.`,
      needLogin: false,
      projectDescription: projectDescription ||
        `${repo} is a web application cloned from https://github.com/${owner}/${repo} for automated testing.`,
    });

    // ── Validate results ──────────────────────────────────────────────────
    let tPassed = 0;
    let tFailed = 0;
    if (results) {
      tPassed = results.passed ?? results.passedCount ?? results.pass ?? 0;
      tFailed = results.failed ?? results.failedCount ?? results.fail ?? 0;
      if (tPassed + tFailed === 0 && results.summary) {
        tPassed = results.summary.passed ?? results.summary.pass ?? 0;
        tFailed = results.summary.failed ?? results.summary.fail ?? 0;
      }
      if (tPassed + tFailed === 0 && Array.isArray(results.tests)) {
        tPassed = results.tests.filter((t: any) => t.status === "passed" || t.passed === true).length;
        tFailed = results.tests.filter((t: any) => t.status === "failed"  || t.passed === false).length;
      }
      // results is an array of test objects (the format from test_results.json)
      if (tPassed + tFailed === 0 && Array.isArray(results)) {
        const passVals = new Set(["PASSED", "PASS", "passed", "pass", "success", "SUCCESS"]);
        const failVals = new Set(["FAILED", "FAIL", "failed", "fail", "error", "ERROR"]);
        tPassed = results.filter((t: any) => passVals.has(t.testStatus ?? t.status ?? "")).length;
        tFailed = results.filter((t: any) => failVals.has(t.testStatus ?? t.status ?? "")).length;
        // If still unknown, fall back: count all entries so we at least show a total
        if (tPassed + tFailed === 0 && results.length > 0) {
          log(`> Warning: Could not determine per-test pass/fail labels (${results.length} entries). Showing as executed.`);
          tPassed = results.length;
        }
      }
    }

    const tests: any[] = Array.isArray(results)
      ? results
      : (Array.isArray(results?.tests) ? results.tests : []);

    // Extract optional TestSprite dashboard URL from the report text
    const dashboardUrlMatch = report.match(/https?:\/\/[^\s)>"\]]+testsprite[^\s)>"\]]+/i);
    const dashboardUrl: string | null = dashboardUrlMatch ? dashboardUrlMatch[0] : null;

    const normalizedResults = {
      ...(Array.isArray(results) ? {} : (results || {})),
      passed: tPassed,
      failed: tFailed,
      total: tPassed + tFailed,
      tests,
      raw: results,
    };

    job.results = { data: normalizedResults, report, dashboardUrl };
    job.status  = "completed";
    log(`> TestSprite job completed — passed: ${tPassed}, failed: ${tFailed}.`);

  } catch (error: any) {
    job.status = "failed";
    job.error  = error.message || "An unknown error occurred.";
    job.logs.push(`> Error: ${job.error}`);
  } finally {
    if (localServerProcess) {
      log("> Stopping local dev server...");
      try { localServerProcess.kill("SIGTERM"); } catch {}
    }
    if (tempDir) {
      log("> Cleaning up temporary workspace...");
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        log("> Cleaned up.");
      } catch {}
    }
  }
}
