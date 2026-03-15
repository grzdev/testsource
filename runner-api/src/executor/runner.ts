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
const CLONE_TIMEOUT_MS = parseInt(process.env.CLONE_TIMEOUT_MS ?? "300000", 10);
const INSTALL_TIMEOUT_MS = parseInt(process.env.INSTALL_TIMEOUT_MS ?? "600000", 10);
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

// Ports currently bound by running dev servers — prevents collisions under concurrent jobs.
const activePorts = new Set<number>();

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = (srv.address() as any)?.port as number;
        srv.close(() => {
          if (activePorts.has(port)) {
            // Extremely rare — retry immediately to get a different port.
            attempt();
          } else {
            activePorts.add(port);
            resolve(port);
          }
        });
      });
      srv.on("error", reject);
    };
    attempt();
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
      env: { ...process.env, PORT: String(port), BROWSER: "none", CI: "true" },
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

    // ── Download repo as tarball ──────────────────────────────────────────
    // Using GitHub's archive/tarball API instead of git clone avoids all git
    // transport layer issues (IPv6, packfile negotiation, etc.).
    setStage("Download repository");
    repoDir = path.join(jobWorkspaceRoot, "repo");
    await fs.mkdir(repoDir, { recursive: true });

    log(`> Download target: ${repoDir}`);
    log(`> Repo           : https://github.com/${owner}/${repo}`);

    // Resolve default branch from GitHub API so we can build the right tarball URL.
    let defaultBranch = "main";
    try {
      const metaHeaders: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (GITHUB_TOKEN) metaHeaders["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
      const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: metaHeaders });
      if (metaRes.ok) {
        const meta = await metaRes.json() as { default_branch?: string };
        defaultBranch = meta.default_branch ?? "main";
      }
    } catch {}
    log(`> Default branch : ${defaultBranch}`);

    // Build tarball URL. For PRs, pull the PR head ref.
    let tarballUrl: string;
    if (type === "pull" && numStr) {
      // GitHub API tarball for PR head (redirects to codeload.github.com)
      tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/pull/${numStr}/head`;
    } else {
      tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${defaultBranch}`;
    }

    const archivePath = path.join(jobWorkspaceRoot, "repo.tar.gz");
    const curlArgs = [
      "-4",                  // force IPv4
      "-L",                  // follow redirects (codeload.github.com)
      "--max-time", String(Math.floor(CLONE_TIMEOUT_MS / 1000)),
      "--retry", "2",
      "--retry-delay", "3",
      "--fail",
      "--silent",
      "--show-error",
    ];
    if (GITHUB_TOKEN) {
      curlArgs.push("-H", `Authorization: Bearer ${GITHUB_TOKEN}`);
    }
    curlArgs.push("-H", "Accept: application/vnd.github+json");
    curlArgs.push(tarballUrl, "-o", archivePath);

    log(`> Downloading tarball (timeout ${CLONE_TIMEOUT_MS / 1000} s)...`);
    await new Promise<void>((resolve, reject) => {
      const dl = spawn("curl", curlArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      dl.stdout.on("data", (d: Buffer) => { out += d.toString(); });
      dl.stderr.on("data", (d: Buffer) => { out += d.toString(); });
      const t = setTimeout(() => {
        dl.kill("SIGKILL");
        reject(new Error(`Tarball download timed out after ${CLONE_TIMEOUT_MS / 1000} s. Check Railway outbound networking.`));
      }, CLONE_TIMEOUT_MS + 5_000);
      dl.on("close", (code) => {
        clearTimeout(t);
        if (code === 0) { resolve(); return; }
        const msg = out.trim().slice(0, 400);
        if (code === 22 || msg.includes("404")) {
          reject(new Error(`Repository not found: github.com/${owner}/${repo}. Check it exists and is public (or GITHUB_TOKEN has access).`));
        } else if (code === 28 || msg.includes("timed out") || msg.includes("Connection timed out")) {
          reject(new Error(`Cannot reach github.com over IPv4 (curl exit 28). Check Railway outbound networking.`));
        } else {
          reject(new Error(`Tarball download failed (curl exit ${code}): ${msg}`));
        }
      });
    });

    // Extract — GitHub tarballs wrap contents in a top-level directory like
    // owner-repo-<sha>/, so --strip-components=1 puts files directly in repoDir.
    log(`> Extracting archive...`);
    await execAsync(`tar -xzf "${archivePath}" --strip-components=1 -C "${repoDir}"`);
    await fs.rm(archivePath, { force: true });

    log(`> Download complete.`);
    // Note: PR head files are already in repoDir via the tarball — no git checkout needed.

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
      // ── Disk diagnostics ─────────────────────────────────────────────
      try {
        const { stdout: dfOut } = await execAsync("df -h / /data 2>/dev/null || df -h /", { timeout: 10_000 });
        log(`> Disk usage:\n${dfOut.trim()}`);
        const { stdout: duJobs } = await execAsync("du -sh /data/jobs 2>/dev/null || echo 'n/a'", { timeout: 10_000 });
        log(`> /data/jobs usage: ${duJobs.trim()}`);
        const { stdout: duNpm } = await execAsync("du -sh /root/.npm 2>/dev/null || echo 'n/a'", { timeout: 10_000 });
        log(`> /root/.npm usage: ${duNpm.trim()}`);
      } catch { /* diagnostics are best-effort */ }

      // Preflight: fail early if free space is below 500 MB
      try {
        const { stdout: dfRaw } = await execAsync("df -k / 2>/dev/null | tail -1", { timeout: 5_000 });
        const freeKb = parseInt(dfRaw.trim().split(/\s+/)[3] ?? "0", 10);
        if (freeKb > 0 && freeKb < 512_000) {
          throw new Error(
            `Runner is low on disk space (${Math.round(freeKb / 1024)} MB free). ` +
            `Clear caches or increase available storage before retrying.`
          );
        }
      } catch (diskErr: any) {
        if (diskErr.message.includes('low on disk')) throw diskErr;
        /* ignore df parse failures */
      }

      log(`> Installing dependencies with ${pm}...`);
      // Route npm cache inside the job workspace so it gets deleted with the job folder.
      const npmCacheDir = path.join(jobWorkspaceRoot, ".npm-cache");
      const installEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "development",
        CI: "true",
        NPM_CONFIG_CACHE: npmCacheDir,
        npm_config_cache: npmCacheDir,
      };

      // Helper: run one install attempt and log its full output; returns true on success.
      const tryInstall = async (extraArgs: string): Promise<boolean> => {
        const cmd = `${pm} install${extraArgs ? ` ${extraArgs}` : ""}`;
        log(`> Running: ${cmd}`);
        try {
          const r = await execAsync(`${cmd} 2>&1`, {
            cwd: workDir,
            timeout: INSTALL_TIMEOUT_MS,
            env: installEnv,
            maxBuffer: 1024 * 1024 * 10,
          });
          const out = (r.stdout ?? "").trim();
          if (out) log(`> Install output:\n${out.slice(0, 3000)}`);
          log(`> Install succeeded (${extraArgs || "no extra flags"}).`);
          return true;
        } catch (err: any) {
          const stdout = (err.stdout ?? "").trim();
          const stderr = (err.stderr ?? "").trim();
          if (stdout) log(`> Install stdout:\n${stdout.slice(0, 3000)}`);
          if (stderr) log(`> Install stderr:\n${stderr.slice(0, 3000)}`);
          log(`> Install failed (${extraArgs || "no extra flags"}).`);
          return false;
        }
      };

      // Three-attempt strategy: --prefer-offline → plain → --legacy-peer-deps (npm only)
      let installOk = await tryInstall("--prefer-offline");
      if (!installOk) {
        log(`> Retrying without --prefer-offline...`);
        installOk = await tryInstall("");
      }
      if (!installOk && pm === "npm") {
        log(`> Retrying with --legacy-peer-deps...`);
        installOk = await tryInstall("--legacy-peer-deps");
      }

      if (!installOk) {
        // Check if any logged line contains ENOSPC to surface clearest message.
        const recentLogs = job.logs.slice(-60).join("\n");
        const isEnospc = /ENOSPC|no space left/i.test(recentLogs);
        if (isEnospc) {
          throw new Error(
            `Dependency installation failed because the runner ran out of disk space (ENOSPC). ` +
            `Old job artifacts or npm caches have likely filled the volume. ` +
            `Retry after storage is freed or increase available disk on the runner.`
          );
        }
        throw new Error(
          `Dependency installation failed after all retries (package manager: ${pm}). ` +
          `See the install output above for the root cause.`
        );
      }

      // Verify the framework's main binary exists in node_modules before continuing.
      const frameworkBin: Record<string, string> = {
        nextjs: path.join(workDir, "node_modules", "next", "package.json"),
        vite:   path.join(workDir, "node_modules", "vite", "package.json"),
        cra:    path.join(workDir, "node_modules", "react-scripts", "package.json"),
      };
      const binCheck = frameworkBin[framework];
      if (binCheck) {
        try {
          await fs.access(binCheck);
        } catch {
          throw new Error(
            `Dependencies installed but the framework package is missing from node_modules. ` +
            `Expected: ${binCheck}. Installation may have succeeded partially.`
          );
        }
      }

      // Ensure TypeScript is present for Next.js repos that use next.config.ts
      if (framework === "nextjs") {
        try {
          await fs.access(path.join(workDir, "node_modules", "typescript"));
        } catch {
          log(`> TypeScript missing after install — installing fallback...`);
          try {
            await execAsync(`${pm} install -D typescript 2>&1`, { cwd: workDir, timeout: 120_000, env: installEnv });
          } catch (e: any) {
            log(`> TypeScript fallback install warning: ${String(e.message).slice(0, 200)}`);
          }
        }
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
      (job as any).__assignedPort = assignedPort; // tracked for cleanup in finally
      const startCmd = buildStartCmd(framework, pm, scriptContent, assignedPort);
      const { cmd, args } = startCmd;
      const spawnEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "development",
        // Force PORT for all frameworks. Next.js/Vite accept -p/--port CLI args,
        // but some repos also read process.env.PORT and will bind 8080 if not overridden.
        PORT: String(assignedPort),
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
      additionalInstruction: `
Test the application at ${targetUrl} as if the goal is to identify whether this repository is a good candidate for open-source contribution.

Generate 8 to 12 meaningful frontend tests when the application has enough surface area. Only generate fewer if the application is genuinely very small (single page, one or two interactions).

Cover these categories where applicable:
1. Initial render and layout — does the page load with expected content?
2. Navigation and routing — do links, menus, and route changes work?
3. Main CTA or core user flow — does the primary action the app offers work end-to-end?
4. Forms and validation — do forms accept valid input, reject invalid input, and show feedback?
5. Empty / loading / error states — are these states handled gracefully?
6. Responsiveness and usability — does the UI behave correctly at different sizes?
7. Accessibility basics — are interactive elements keyboard-reachable and labeled?
8. Regression-prone interactions — modals, dropdowns, toggles, accordions.

Avoid shallow smoke tests. Prefer realistic user journeys and interaction-heavy tests that expose bugs.

For every FAILED test, provide in the result:
- a specific, descriptive test title (not "Generated Frontend Test N")
- what the user attempted
- expected behavior
- actual behavior
- why this matters to a real user
- the likely area of the codebase involved (e.g. routing, form handler, state management, CSS)
`,
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

    // ── Normalize raw test objects to a stable display schema ────────────
    // Real test_results.json fields: title, description, testStatus, testError,
    // testType, testVisualization, priority — map them to canonical names.
    const PASS_RE = /^(PASS|PASSED|SUCCESS)$/i;
    const normalizedTests = tests.map((t: any, idx: number) => ({
      ...t,
      // Canonical name — TestSprite writes "TC007-PR mode: ..." into `title`
      testName:     t.title     ?? t.testCaseTitle ?? t.testName ?? t.name ?? `Frontend Test ${idx + 1}`,
      // Canonical error — detailed assertion text lives in `testError`
      errorMessage: t.testError ?? t.error         ?? t.errorMessage ?? null,
      // Canonical pass flag
      isPassed:     PASS_RE.test((t.testStatus ?? t.status ?? "").toUpperCase()),
    }));

    // Recompute counts from normalized tests (more reliable than the rough pass above)
    const nPassed = normalizedTests.filter((t) => t.isPassed).length;
    const nFailed = normalizedTests.length - nPassed;
    if (nPassed + nFailed > 0) { tPassed = nPassed; tFailed = nFailed; }

    // ── Low-coverage detection ───────────────────────────────────────────
    const limitedCoverage = normalizedTests.length < 5;

    // ── Contributor verdict (computed in backend so frontend is presentational) ──
    const passRate = normalizedTests.length > 0 ? Math.round((nPassed / normalizedTests.length) * 100) : 0;
    let contributorVerdict: string;
    let contributorReason: string;
    if (limitedCoverage) {
      contributorVerdict = "not_enough_evidence";
      contributorReason  = `Only ${normalizedTests.length} test${normalizedTests.length !== 1 ? "s" : ""} were generated. The app surface area may be too small or the dev server did not expose enough UI.`;
    } else if (nFailed === 0) {
      contributorVerdict = "weak_candidate";
      contributorReason  = "All visible tests passed. Core flows appear to work; contribution opportunities may exist in less-explored areas.";
    } else if (nFailed / normalizedTests.length <= 0.4) {
      contributorVerdict = "possible_candidate";
      contributorReason  = `${nFailed} out of ${normalizedTests.length} tests failed. There are visible issues a contributor could investigate.`;
    } else {
      contributorVerdict = "strong_candidate";
      contributorReason  = `${nFailed} out of ${normalizedTests.length} tests failed. Clear, browser-confirmed bugs were found — this repo is actively worth contributing to.`;
    }
    log(`> Contributor verdict: ${contributorVerdict} (${passRate}% pass, coverage limited: ${limitedCoverage})`);

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
        tests: normalizedTests,
        raw: results,
        limitedCoverage,
        contributorVerdict,
        contributorReason,
        passRate,
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
    // Release reserved port so concurrent jobs can reuse it.
    const assignedPortVal: number | undefined = (job as any).__assignedPort;
    if (assignedPortVal) activePorts.delete(assignedPortVal);
    if (repoDir) {
      log("> Cleaning up workspace...");
      try {
        await fs.rm(path.join(BASE_DIR, jobId), { recursive: true, force: true });
        log("> Cleaned up.");
      } catch {}
    }
    // Aggressive cache purge to prevent ENOSPC from accumulating across jobs.
    try {
      await execAsync("rm -rf /root/.npm/_npx /root/.npm/_cacache/tmp 2>/dev/null || true", { timeout: 15_000 });
    } catch { /* best-effort */ }
  }
}
