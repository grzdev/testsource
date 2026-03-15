type JobRunner = (jobId: string) => Promise<void>;

const queue: string[] = [];
let running = 0;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS ?? "1", 10);

let runnerFn: JobRunner | null = null;

export function setRunner(fn: JobRunner): void {
  runnerFn = fn;
}

export function enqueue(jobId: string): void {
  queue.push(jobId);
  flush();
}

function flush(): void {
  if (running >= MAX_CONCURRENT || queue.length === 0 || !runnerFn) return;
  const jobId = queue.shift()!;
  running++;
  runnerFn(jobId)
    .catch((err) => console.error(`Job ${jobId} crashed outside executor:`, err))
    .finally(() => {
      running--;
      flush();
    });
}

export function getQueueDepth(): number {
  return queue.length;
}

export function getRunningCount(): number {
  return running;
}
