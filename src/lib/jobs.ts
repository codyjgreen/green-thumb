export type JobStatus = 'queued' | 'extracting' | 'chunking' | 'embedding' | 'done' | 'failed';

export interface IngestJob {
  id: string;
  status: JobStatus;
  bookId?: string;
  title?: string;
  stageLabel: string;
  totalSections?: number;
  processedSections?: number;
  totalChunks?: number;
  processedChunks?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const jobs = new Map<string, IngestJob>();
// Timer handles for scheduled deletions (prevents duplicate timers)
const jobTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Auto-delete a job after this many ms once it reaches a terminal state
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createJob(id: string): IngestJob {
  const job: IngestJob = {
    id,
    status: 'queued',
    stageLabel: 'Queued...',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): IngestJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Omit<IngestJob, 'id' | 'createdAt'>>): void {
  const job = jobs.get(id);
  if (!job) return;

  // Cancel any pending auto-delete timer before re-scheduling
  const existingTimer = jobTimers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    jobTimers.delete(id);
  }

  Object.assign(job, patch, { updatedAt: new Date() });

  // Schedule auto-deletion for terminal states
  if (job.status === 'done' || job.status === 'failed') {
    const timer = setTimeout(() => {
      jobs.delete(id);
      jobTimers.delete(id);
    }, JOB_TTL_MS);
    jobTimers.set(id, timer);
  }
}

export function deleteJob(id: string): void {
  const timer = jobTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    jobTimers.delete(id);
  }
  jobs.delete(id);
}
