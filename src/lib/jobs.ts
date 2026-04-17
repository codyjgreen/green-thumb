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
  Object.assign(job, patch, { updatedAt: new Date() });
}

export function deleteJob(id: string): void {
  jobs.delete(id);
}
