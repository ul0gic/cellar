import type { Job } from '@cellar/contract';
import { html, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../../app/api.ts';
import { formatNumber } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';

// D-3 §15 (design/D-3.md:956): the client polls getJob every second until the job stops running.
const POLL_MS = 1000;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function followJob(
  first: Job,
  onProgress: (job: Job) => void,
  active: () => boolean,
): Promise<Job | null> {
  let job = first;
  onProgress(job);
  while (job.state === 'running') {
    // biome-ignore lint/performance/noAwaitInLoops: each poll waits for the previous answer, one request per second
    await pause(POLL_MS);
    if (!active()) {
      return null;
    }
    try {
      job = await call('getJob', { params: { id: job.id } });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'network_error') {
        continue;
      }
      throw error;
    }
    onProgress(job);
  }
  return job;
}

export function jobProgress(job: Job, label: string): TemplateResult {
  if (job.total === null) {
    return html`<lc-progress-bar indeterminate label=${label}></lc-progress-bar>
      <p class="cl-job-count" aria-live="polite">${job.step}</p>`;
  }
  return html`<lc-progress-bar value=${job.done} max=${job.total} label=${label}></lc-progress-bar>
    <p class="cl-job-count" aria-live="polite">
      ${text('settings.job.count', { step: job.step, done: formatNumber(job.done), total: formatNumber(job.total) })}
    </p>`;
}
