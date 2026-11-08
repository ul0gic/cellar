import { randomUUID } from 'node:crypto';
import type { CatalogApplyReport, Job, JobKind, RestoreReport } from '@cellar/contract';
import type { Logger } from './logger.ts';
import { ProblemError, problem, problemBody } from './problems.ts';

export const JOB_STEPS = {
  catalog_load: [
    'Checking the catalog',
    'Adding glasses, methods and utensils',
    'Adding ingredients',
    'Adding recipes',
    'Copying images',
    'Done',
  ],
  catalog_apply: ['Downloading', 'Checking the download', 'Adding new records', 'Copying images', 'Done'],
  restore: [
    'Putting your current data aside',
    'Restoring the database',
    'Restoring images',
    'Updating the database',
    'Done',
  ],
} as const satisfies Readonly<Record<JobKind, readonly string[]>>;

const FINISHED_KEPT = 10;

export interface JobProgress {
  step(text: string, total: number | null): void;
  done(n: number): void;
}

type JobResult = CatalogApplyReport | RestoreReport;

export interface JobRunner {
  start(kind: JobKind, startedBySessionHash: string | null, run: (report: JobProgress) => Promise<JobResult>): Job;
  get(id: string, viewerSessionHash?: string): Job | null;
  running(): Job | null;
}

interface JobRecord {
  job: Job;
  readonly sessionHash: string | null;
}

export function createJobRunner(log: Logger, now: () => Date): JobRunner {
  const records = new Map<string, JobRecord>();
  let current: JobRecord | null = null;

  const finish = (record: JobRecord, patch: Pick<Job, 'state' | 'result' | 'error'> & Partial<Pick<Job, 'step'>>) => {
    record.job = { ...record.job, ...patch, finishedAt: now().toISOString() };
    current = null;
    const finished = [...records.values()].filter((entry) => entry.job.state !== 'running');
    for (const stale of finished.slice(0, Math.max(0, finished.length - FINISHED_KEPT))) {
      records.delete(stale.job.id);
    }
  };

  return {
    start(kind, startedBySessionHash, run) {
      if (current !== null) {
        throw problem(current.job.kind === 'restore' ? 'job_running' : 'catalog_busy');
      }
      const record: JobRecord = {
        job: {
          id: randomUUID(),
          kind,
          state: 'running',
          step: JOB_STEPS[kind][0],
          done: 0,
          total: null,
          startedAt: now().toISOString(),
          finishedAt: null,
          result: null,
          error: null,
        },
        sessionHash: startedBySessionHash,
      };
      records.set(record.job.id, record);
      current = record;
      const jobLog = log.child({ jobId: record.job.id, kind });
      jobLog.info(`Job started: ${record.job.step}`);
      const progress: JobProgress = {
        step(text, total) {
          record.job = { ...record.job, step: text, done: 0, total };
          jobLog.info(`Job step: ${text}`);
        },
        done(n) {
          record.job = { ...record.job, done: n };
        },
      };
      run(progress).then(
        (result) => {
          finish(record, { state: 'succeeded', step: 'Done', result, error: null });
          jobLog.info('Job succeeded');
        },
        (error: unknown) => {
          if (!(error instanceof ProblemError)) {
            jobLog.error('Job failed', { err: error });
          }
          const failure = error instanceof ProblemError ? error : problem('internal_error');
          finish(record, { state: 'failed', result: null, error: problemBody(failure, record.job.id) });
          jobLog.info(`Job failed: ${failure.code}`);
        },
      );
      return record.job;
    },
    get(id, viewerSessionHash) {
      const record = records.get(id);
      if (record === undefined) {
        return null;
      }
      if (record.job.kind === 'restore' && (record.sessionHash === null || record.sessionHash !== viewerSessionHash)) {
        return null;
      }
      return record.job;
    },
    running() {
      return current?.job ?? null;
    },
  };
}
