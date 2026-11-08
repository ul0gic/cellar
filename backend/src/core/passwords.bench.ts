import { stdout } from 'node:process';
import { hashPassword } from './passwords.ts';

const RUNS = 20;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const timings: number[] = [];
for (let run = 0; run < RUNS; run += 1) {
  const started = performance.now();
  await hashPassword(`bench-password-${run}`);
  timings.push(performance.now() - started);
}
timings.sort((a, b) => a - b);
stdout.write(
  `argon2id m=19456 t=2 p=1 over ${RUNS} hashes: p50 ${percentile(timings, 50).toFixed(1)} ms, p95 ${percentile(timings, 95).toFixed(1)} ms\n`,
);
