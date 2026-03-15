export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobState {
  id: string;
  repoUrl: string;
  status: JobStatus;
  stage: string;
  logs: string[];
  results?: any;
  error?: string;
  proxyUrl?: string;
  createdAt: number;
  updatedAt: number;
}
