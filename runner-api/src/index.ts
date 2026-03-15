import express from "express";
import cors from "cors";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { createJob, getJob, getAllJobs } from "./store/jobs";
import { enqueue, setRunner, getQueueDepth, getRunningCount } from "./queue/manager";
import { runJob } from "./executor/runner";

const execFileAsync = promisify(execFile);

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.CORS_ORIGIN;
app.use(
  cors(
    allowedOrigin
      ? {
          origin: allowedOrigin,
          methods: ["GET", "POST", "OPTIONS"],
        }
      : undefined // open during development
  )
);

app.use(express.json());

// Register the job runner with the queue
setRunner(runJob);

// ── Routes ─────────────────────────────────────────────────────────────────

/** Health check */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    queue: getQueueDepth(),
    running: getRunningCount(),
    baseDir: process.env.RUNNER_BASE_DIR ?? "/data/jobs",
  });
});

/** Create a new job */
app.post("/jobs", (req, res) => {
  const { githubUrl } = req.body as { githubUrl?: string };
  if (!githubUrl || typeof githubUrl !== "string" || !githubUrl.trim()) {
    return res.status(400).json({ error: "githubUrl is required." });
  }

  // Basic URL safety check
  let parsed: URL;
  try {
    parsed = new URL(
      githubUrl.startsWith("http") ? githubUrl : `https://${githubUrl}`
    );
  } catch {
    return res.status(400).json({ error: "githubUrl is not a valid URL." });
  }
  if (parsed.hostname !== "github.com") {
    return res.status(400).json({ error: "Only github.com URLs are accepted." });
  }

  const jobId = crypto.randomBytes(4).toString("hex");
  createJob(jobId, githubUrl.trim());
  enqueue(jobId);

  return res.status(201).json({ jobId });
});

/** Get job status (full state) */
app.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  return res.json(job);
});

/** Get job logs only */
app.get("/jobs/:id/logs", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });
  return res.json({ logs: job.logs });
});

/** List recent jobs */
app.get("/jobs", (_req, res) => {
  return res.json(
    getAllJobs().map((j) => ({
      id: j.id,
      repoUrl: j.repoUrl,
      status: j.status,
      stage: j.stage,
      createdAt: j.createdAt,
      error: j.error,
    }))
  );
});

// ── Start ──────────────────────────────────────────────────────────────────

/** Network debug — tests outbound HTTPS from the Railway container to GitHub hosts.
 *  GET /debug/network
 *  Returns per-host: reachable (bool), statusCode, latencyMs, error
 */
app.get("/debug/network", async (_req, res) => {
  const targets = [
    "https://api.github.com",
    "https://github.com",
    "https://codeload.github.com",
    "https://objects.githubusercontent.com",
  ];

  const probe = async (url: string) => {
    const start = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(
        "curl",
        ["-4", "-I", "--max-time", "15", "--silent", "--write-out", "%{http_code}", url],
        { timeout: 20_000 }
      );
      const combined = stdout + stderr;
      const code = combined.trim().slice(-3);
      return { url, reachable: true, statusCode: parseInt(code, 10) || null, latencyMs: Date.now() - start, error: null };
    } catch (e: unknown) {
      return { url, reachable: false, statusCode: null, latencyMs: Date.now() - start, error: (e as Error).message.slice(0, 200) };
    }
  };

  const results = await Promise.all(targets.map(probe));
  res.json({ results });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[runner-api] Listening on port ${PORT}`);
  console.log(`[runner-api] Base dir: ${process.env.RUNNER_BASE_DIR ?? "/data/jobs"}`);
  console.log(`[runner-api] Max concurrent jobs: ${process.env.MAX_CONCURRENT_JOBS ?? "1"}`);
});
