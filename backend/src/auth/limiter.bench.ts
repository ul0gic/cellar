import { stdout } from 'node:process';
import { createSignInLimiter } from './limiter.ts';

const NAMES = 20_000;

const limiter = createSignInLimiter();
const started = performance.now();
const now = Date.now();
for (let index = 0; index < NAMES; index += 1) {
  limiter.recordFailure(`attacker-name-${index}`, `198.51.100.${index % 256}`, now);
}
stdout.write(
  `sign-in limiter after ${NAMES} failed names: ${limiter.size()} keys (bound 10000), ${(performance.now() - started).toFixed(1)} ms\n`,
);
