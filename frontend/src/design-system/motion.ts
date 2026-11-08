const ARRIVAL_KEY = 'cellar.arrived';
const PENDING = 'pending';
const DONE = 'done';
// D-1 §5.2: the count-up starts 200 ms into the first-arrival sequence.
const COUNT_DELAY_MS = 200;

function readArrival(): string | null {
  try {
    return sessionStorage.getItem(ARRIVAL_KEY);
  } catch (error) {
    if (error instanceof DOMException) {
      return null;
    }
    throw error;
  }
}

function writeArrival(value: string): void {
  try {
    sessionStorage.setItem(ARRIVAL_KEY, value);
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
}

export function armFirstArrival(): void {
  writeArrival(PENDING);
}

export function takeFirstArrival(): boolean {
  if (readArrival() !== PENDING) {
    return false;
  }
  writeArrival(DONE);
  return true;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function durationMs(token: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return Number.parseFloat(value);
}

export function countUp(element: HTMLElement, value: number, format: (n: number) => string): void {
  element.textContent = format(value);
  if (prefersReducedMotion()) {
    return;
  }
  const duration = durationMs('--dur-count');
  const start = performance.now() + COUNT_DELAY_MS;
  const step = (now: number): void => {
    const progress = Math.min(1, Math.max(0, (now - start) / duration));
    const eased = 1 - (1 - progress) ** 4;
    element.textContent = format(Math.round(value * eased));
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}
