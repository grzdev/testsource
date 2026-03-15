// Job executor — ported from lib/jobs.ts for the Railway runner.
// Uses /data/jobs/{jobId}/ as workspace root instead of os.tmpdir().
import { exec, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as http from "http";
import * as https from "https";
import { getJob } from "../store/jobs";
import { TestSpriteApp } from "./testsprite";

const execAsync = promisify(exec);

const BASE_DIR = process.env.RUNNER_BASE_DIR ?? "/data/jobs";
const JOB_TIMEOUT_MS = parseInt(process.env.JOB_TIMEOUT_MS ?? "900000", 10);
const INSTALL_TIMEOUT_MS = parseInt(process.env.INSTALL_TIMEOUT_MS ?? "120000", 10);
const SERVER_START_TIMEOUT_MS = parseInt(process.env.SERVER_START_TIMEOUT_MS ?? "60000", 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

// ── Helpers ────────────────────────────────────────────────────────────────

function probeHtml(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    try {
      const req = client.get(url, { timeout: timeoutMs } as any, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          res.resume();
          probeHtml(res.headers.location as string, timeoutMs).then(resolve);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
        const ct = String(res.headers["content-type"] ?? "");
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

async function waitForHtml(url: string, totalTimeoutMs: number, logFn: (m: string) => void): Promise<boolean> {
  const deadline = Date.now() + totalTimeoutMs;
  while (Date.now() < deadline) {
    if (await probeHtml(url, 8_000)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  logFn(`> Dev server at ${url} did not serve valid HTML within the timeout.`);
  return false;
}

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

type Framework = "nextjs" | "vite" | "cra" | "unknown";

function detectFramework(pkg: any): Framework {
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (allDeps["next"]) return "nextjs";
  if (allDeps["vite"] || allDeps["@sveltejs/kit"]) return "vite";
  if (allDeps["react-scripts"]) return "cra";
  return "unknown";
}

function buildStartCmd(
  framework: Framework,
  pm: "pnpm" | "yarn" | "npm",
  scriptContent: string,
  port: number
): { cmd: string; args: string[]; env?: NodeJS.ProcessEnv } {
  const exec = (bin: string, ...rest: string[]) =>
    pm === "pnpm"
      ? { cmd: "pnpm", args: ["exec", bin, ...rest] }
      : pm === "yarn"
      ? { cmd: "yarn", args: ["exec", bin, ...rest] }
      : { cmd: "npx", args: ["--no-install", bin, ...rest] };

  if (framework === "nextjs") {
    const turbo = /--turbo(?:pack)?/.test(scriptContent) ? ["--turbopack"] : [];
    return exec("next", "dev", ...turbo, "-p", String(port));
  }
  if (framework === "vite") {
    return exec("vite", "--host", "0.0.0.0", "--port", String(port));
  }
  if (framework === "cra") {
    return {
      cmd: pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm",
      args: pm === "yarn" ? ["start"] : ["run", "start"],
      env: { PORT: String(port), BROWSER: "none", CI: "true" },
    };
  }
  throw new Error(
    "Only Next.js, Vite/SvelteKit, and Create-React-App repos are supported. " +
      "Please provide a deployed preview URL instead."
  );
}

async function detectPackageManager(workDir: string): Promise<"pnpm" | "yarn" | "npm"> {
  try { await fs.stat(path.join(workDir, "pnpm-lock.yaml")); return "pnpm"; } catch {}
  try { await fs.stat(path.join(workDir, "yarn.lock")); return "yarn"; } catch {}
  return "npm";
}

/** Fetch PR comments to look for a deployed preview URL. */
async function fetchPrComments(owner: string, repo: string, prNumber: number): Promise<{ body: string }[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=30&sort=created&direction=desc`,
      { headers }
    );
    if (!res.ok) return [];
    const data = await res.json() as any[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ── Main Job Runner ────────────────────────────────────────────────────────

export async function runJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const log = (msg: string) => {
    job.logs.push(msg);
    job.updatedAt = Date.now();
    // Capture TestSprite proxy/tunnel URL
    if (!job.proxyUrl) {
      const m = msg.match(/proxy\s+url[:\s]+(https?:\/\/\S+)/i);
      if (m) {
        job.proxyUrl = m[1].replace(/[.,;>'"]+$/, "");
      } else {
        const dm = msg.match(
          /(https?:\/\/localhost:\d{4,5}\/(?:modification|dashboard)[^\s'"<>]*)/i
        );
        if (dm) job.proxyUrl = dm[1].replace(/[.,;>'"]+$/, "");
      }
    }
  };

  const setStage = (stage: string) => {
    job.stage = stage;
    job.updatedAt = Date.now();
  };

  job.status = "running";
  job.updatedAt = Date.now();

  // Create a per-job workspace on the Railway volume
  const jobWorkspaceRoot = path.join(BASE_DIR, jobId);
  await fs.mkdir(jobWorkspaceRoot, { recursive: true });

  let localServerProcess: ReturnType<typeof spawn> | null = null;
  let repoDir = "";

  // Hard cap on total job duration
  const abortController = new AbortController();
  const jobTimeoutHandle = setTimeout(() => {
    abortController.abort();
  }, JOB_TIMEOUT_MS);

  try {
    setStage("Analyze URL");
    log(`> Analyzing URL: ${job.repoUrl}`);

    const rawUrl = job.repoUrl.startsWith("http") ? job.repoUrl : `https://${job.repoUrl}`;
    const u = new URL(rawUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("Invalid GitHub URL — expected https://github.com/owner/repo");

    const owner = parts[0];
    const repoRaw = parts[1];
    const type = parts[2] ?? null; // pull | tree | null
    const numStr = parts[3] ?? null;

    let subpath = "";
    if (type === "tree" && parts.length > 4) {
      subpath = parts.slice(4).join("/");
    }

    const repo = repoRaw.replace(/\.git$/, "");
    const cloneUrl = GITHUB_TOKEN
      ? `https://${GITHUB_TOKEN}@github.com/${owner}/${repo}`
      : `https://github.com/${owner}/${repo}`;

    if (type === "issues") {
      throw new Error(
        "Issues do not map to a runnable application. Paste a PR or repo link instead."
      );
    }

    // ── Scan PR for preview deployment URL ───────────────────────────────
    let targetUrl: string | null = null;

    if (type === "pull" && numStr) {
      log(`> Scanning PR #${numStr} comments for preview URL...`);
      const comments = await fetchPrComments(owner, repo, parseInt(numStr, 10));
      const previewPattern =
        /https:\/\/[a-zA-Z0-9-]+\.(?:vercel\.app|netlify\.app|pages\.dev|fly\.dev|up\.railway\.app|onrender\.com|azurestaticapps\.net)[^\s)]*/;
      for (const c of comments) {
        const m = c.body.match(previewPattern);
        if (m) { targetUrl = m[0]; break; }
      }
      if (targetUrl) log(`> Found preview URL: ${targetUrl}`);
      else log(`> No preview URL found in PR comments. Will run locally.`);
    }

    // ── Clone ────────────────────────────────────────────────────────────
    setStage("Clone repository");
    repoDir = path.join(jobWorkspaceRoot, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    log(`> Cloning https://github.com/${owner}/${repo} (shallow)...`);

    // Use spawn so we stream ALL git output live and never miss a fatal line
    await new Promise<void>((resolve, reject) => {
      const gitEnv: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
        GIT_CONFIG_NOSYSTEM: "1",
        LANG: "C",
      };

      const stripToken = (s: string) =>
        s.replace(/https:\/\/[^@\s]+@github\.com/g, "https://github.com");

      const child = spawn(
        "git",
        ["clone", "--depth", "1", "--progress", cloneUrl, "."],
        { cwd: repoDir, env: gitEnv, stdio: ["ignore", "pipe", "pipe"] }
      );

      let allOutput = "";

      const onData = (data: Buffer) => {
        const line = stripToken(data.toString());
        allOutput += line;
        for (const l of line.split("\n")) {
          const t = l.trim();
          if (t) log(`  [git] ${t}`);
        }
      };

      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      const timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`git clone timed out after 120 s for github.com/${owner}/${repo}`));
      }, 120_000);

      child.on("error", (spawnErr) => {
        clearTimeout(timeoutHandle);
        reject(new Error(`git spawn error: ${spawnErr.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timeoutHandle);
        if (code === 0) {
          resolve();
          return;
        }
        const msg = allOutput.trim() || `git exited with code ${code}`;
        const lower = msg.toLowerCase();
        if (lower.includes("not found") || lower.includes("does not exist")) {
          reject(new Error(`Repository not found: github.com/${owner}/${repo}. Make sure it exists and is public (or your token has access).`));
        } else if (lower.includes("authentication failed") || lower.includes("could not read username") || lower.includes("terminal prompts disabled")) {
          reject(new Error(`Git authentication failed for github.com/${owner}/${repo}. Check that GITHUB_TOKEN on Railway is valid and has repo read access.`));
        } else {
          reject(new Error(`Clone failed (exit ${code}) for github.com/${owner}/${repo}: ${msg.slice(0, 800)}`));
        }
      });
    });

    if (type === "pull" && numStr) {
      log(`> Checking out PR #${numStr}...`);
      try {
        await execAsync(`git fetch origin pull/${numStr}/head:pr-${numStr}`, { cwd: repoDir });
        await execAsync(`git checkout pr-${numStr}`, { cwd: repoDir });
        log(`> PR #${numStr} checked out.`);
      } catch (err: any) {
        log(`> Warning: could not checkout PR head: ${err.message}. Using default branch.`);
      }
    }

    const workDir = subpath ? path.join(repoDir, subpath) : repoDir;
    if (subpath) log(`> Using subpath: ${subpath}`);

    // ── Local sandbox bootstrap (only if no remote target) ───────────────
    const isRemoteTarget = !!targetUrl;
    let projectDescription = "";

    if (!targetUrl) {
      const pkgPath = path.join(workDir, "package.json");
      let pkg: any;
      try {
        pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      } catch {
        throw new Error(
          "No package.json found. This may not be a Node.js project."
        );
      }

      const isLibrary =
        !pkg.scripts?.dev &&
        !pkg.scripts?.start &&
        !pkg.scripts?.preview &&
        (pkg.main || pkg.types || pkg.exports);
      if (isLibrary) {
        throw new Error(
          "Repository appears to be a library or CLI tool (no dev/start script). " +
            "TestSprite requires a running web app. Provide a deployment URL."
        );
      }

      const pm = await detectPackageManager(workDir);
      log(`> Package manager: ${pm}`);

      const framework = detectFramework(pkg);
      log(`> Framework: ${framework}`);
      if (framework === "unknown") {
        throw new Error(
          "Could not identify a supported framework (Next.js, Vite, Create React App). " +
            "Provide a deployed preview URL instead."
        );
      }

      // ── Install dependencies ────────────────────────────────────────────
      setStage("Install dependencies");
      log(`> Installing dependencies with ${pm}...`);
      try {
        const installResult = await execAsync(
          `${pm} install --prefer-offline 2>&1`,
          { cwd: workDir, timeout: INSTALL_TIMEOUT_MS }
        );
        if (installResult.stdout) log(`  ${installResult.stdout.slice(0, 300)}`);
      } catch (err: any) {
        log(`> Install warning: ${String(err.message).slice(0, 300)}`);
      }

      // ── Read README for project description ────────────────────────────
      projectDescription = (pkg.description as string | undefined) ?? "";
      for (const readmeFile of ["README.md", "README", "readme.md"]) {
        try {
          const readme = await fs.readFile(path.join(workDir, readmeFile), "utf-8");
          projectDescription = readme.slice(0, 1500);
          break;
        } catch {}
      }

      // ── Start dev server ───────────────────────────────────────────────
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

      log(`> Port: ${assignedPort} | Command: ${cmd} ${args.join(" ")}`);

      let runtimePort: number | null = null;
      let serverFailed = false;
      let serverFailReason = "";
      const urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/i;

      localServerProcess = spawn(cmd, args, {
        cwd: workDir,
        shell: false,
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
            log(`> Dev server URL: http://localhost:${runtimePort}`);
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

      log(`> Waiting for dev server URL (up to 30 s)...`);
      for (let i = 0; i < 150 && !runtimePort && !serverFailed; i++) {
        await new Promise((r) => setTimeout(r, 200));
      }

      if (serverFailed) {
        throw new Error(
          `Dev server failed to start: ${serverFailReason} ` +
            `Command: ${cmd} ${args.join(" ")}.`
        );
      }

      const confirmedPort = runtimePort ?? assignedPort;
      const confirmedUrl = `http://localhost:${confirmedPort}`;

      setStage("Verify HTML target");
      log(`> Waiting for ${confirmedUrl} to serve HTML (up to ${SERVER_START_TIMEOUT_MS / 1000} s)...`);
      const htmlReady = await waitForHtml(confirmedUrl, SERVER_START_TIMEOUT_MS, log);
      if (!htmlReady) {
        throw new Error(
          `Dev server at ${confirmedUrl} did not serve a valid HTML response. ` +
            "The app may require env variables, or may be failing to compile."
        );
      }

      log(`> Dev server confirmed at ${confirmedUrl}`);
      targetUrl = confirmedUrl;
    }

    // ── Validate remote targets ──────────────────────────────────────────
    if (isRemoteTarget && targetUrl) {
      setStage("Verify HTML target");
      log(`> Checking remote target: ${targetUrl}`);
      const ok = await probeHtml(targetUrl, 8000);
      if (!ok) {
        const alive = await probeUrl(targetUrl, 5000);
        if (!alive) {
          throw new Error(`Target URL is not reachable: ${targetUrl}`);
        }
        throw new Error(`Target URL did not serve a valid HTML page: ${targetUrl}`);
      }
      log(`> Remote target confirmed at ${targetUrl}`);
    }

    // ── TestSprite MCP ───────────────────────────────────────────────────
    setStage("Initialize MCP");
    log(`> Starting TestSprite...`);

    const apiKey = process.env.TESTSPRITE_API_KEY;
    if (!apiKey) throw new Error("TESTSPRITE_API_KEY env var is missing.");

    const app = new TestSpriteApp();
    app.onLog   = (msg) => log(`> ${msg}`);
    app.onStage = (stage) => setStage(stage);

    const { results, report } = await app.start({
      projectPath: workDir || repoDir,
      projectName: repo,
      targetUrl: targetUrl!,
      apiKey,
      additionalInstruction: `Test the application at ${targetUrl}. Focus on core user-facing flows, navigation, and UI interactions.`,
      needLogin: false,
      projectDescription:
        projectDescription ||
        `${repo} is a web application cloned from https://github.com/${owner}/${repo}.`,
    });

    // ── Normalize results ────────────────────────────────────────────────
    let tPassed = 0;
    let tFailed = 0;
    if (results) {
      tPassed = (results as any).passed ?? (results as any).passedCount ?? 0;
      tFailed = (results as any).failed ?? (results as any).failedCount ?? 0;
      if (tPassed + tFailed === 0 && (results as any).summary) {
        tPassed = (results as any).summary.passed ?? 0;
        tFailed = (results as any).summary.failed ?? 0;
      }
      if (tPassed + tFailed === 0 && Array.isArray((results as any).tests)) {
        tPassed = (results as any).tests.filter((t: any) => t.status === "passed" || t.passed === true).length;
        tFailed = (results as any).tests.filter((t: any) => t.status === "failed" || t.passed === false).length;
      }
      if (tPassed + tFailed === 0 && Array.isArray(results)) {
        const passVals = new Set(["PASSED", "PASS", "passed", "pass", "success", "SUCCESS"]);
        const failVals = new Set(["FAILED", "FAIL", "failed", "fail", "error", "ERROR"]);
        tPassed = (results as any[]).filter((t: any) => passVals.has(t.testStatus ?? t.status ?? "")).length;
        tFailed = (results as any[]).filter((t: any) => failVals.has(t.testStatus ?? t.status ?? "")).length;
        if (tPassed + tFailed === 0 && (results as any[]).length > 0) {
          tPassed = (results as any[]).length;
        }
      }
    }

    const tests: any[] = Array.isArray(results)
      ? results as any[]
      : Array.isArray((results as any)?.tests) ? (results as any).tests : [];

    const dashboardUrlMatch = typeof report === "string"
      ? report.match(/https?:\/\/[^\s)>"'\]]+testsprite[^\s)>"'\]]+/i)
      : null;
    const dashboardUrl: string | null = dashboardUrlMatch ? dashboardUrlMatch[0] : null;

    job.results = {
      data: {
        ...((Array.isArray(results) ? {} : (results ?? {})) as object),
        passed: tPassed,
        failed: tFailed,
        total: tPassed + tFailed,
        tests,
        raw: results,
      },
      report,
      dashboardUrl,
    };
    job.status = "completed";
    job.updatedAt = Date.now();
    log(`> Job completed — passed: ${tPassed}, failed: ${tFailed}.`);

  } catch (err: any) {
    job.status = "failed";
    job.error = err.message ?? "An unknown error occurred.";
    job.logs.push(`> Error: ${job.error}`);
    job.updatedAt = Date.now();
  } finally {
    clearTimeout(jobTimeoutHandle);
    if (localServerProcess) {
      log("> Stopping dev server...");
      try { localServerProcess.kill("SIGTERM"); } catch {}
    }
    if (repoDir) {
      log("> Cleaning up workspace...");
      try {
        await fs.rm(path.join(BASE_DIR, jobId), { recursive: true, force: true });
        log("> Cleaned up.");
      } catch {}
    }
  }
}
