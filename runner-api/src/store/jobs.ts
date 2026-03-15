import type { JobState } from "../types";

const jobs = new Map<string, JobState>();

export function createJob(id: string, repoUrl: string): JobState {
  const job: JobState = {
    id,
    repoUrl,
    status: "pending",
    stage: "Queued",
    logs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function getAllJobs(): JobState[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
}
