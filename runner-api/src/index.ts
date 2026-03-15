import express from "express";
import cors from "cors";
import crypto from "crypto";
import { createJob, getJob, getAllJobs } from "./store/jobs";
import { enqueue, setRunner, getQueueDepth, getRunningCount } from "./queue/manager";
import { runJob } from "./executor/runner";

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[runner-api] Listening on port ${PORT}`);
  console.log(`[runner-api] Base dir: ${process.env.RUNNER_BASE_DIR ?? "/data/jobs"}`);
  console.log(`[runner-api] Max concurrent jobs: ${process.env.MAX_CONCURRENT_JOBS ?? "1"}`);
});
