import { ApiError } from '../../../app/api.ts';
import { router } from '../../../app/router.ts';

export interface Watchable {
  subscribe(cb: () => void): () => void;
  readonly error: { subscribe(cb: () => void): () => void; peek(): unknown };
  ensure(): Promise<unknown>;
  refresh(): Promise<unknown>;
}

// D-1 §8.26: skeletons appear only when a response takes longer than 300 ms.
const SKELETON_AFTER_MS = 300;

export function onLeave(element: HTMLElement, cleanup: () => void): void {
  const stop = router.subscribe(() => {
    if (!element.isConnected) {
      stop();
      cleanup();
    }
  });
}

function shownThroughSignal(error: unknown): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
}

export function watch(source: Watchable, draw: () => void): () => void {
  const stops = [source.subscribe(draw), source.error.subscribe(draw)];
  source.ensure().catch(shownThroughSignal);
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}

export function reload(source: Watchable): void {
  source.refresh().catch(shownThroughSignal);
}

export function triggerOf(event: Event, fallback: Element): Element {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  if (typeof detail === 'object' && detail !== null && 'trigger' in detail && detail.trigger instanceof Element) {
    return detail.trigger;
  }
  return event.currentTarget instanceof Element ? event.currentTarget : fallback;
}

export function slowFlag(draw: () => void): { readonly slow: () => boolean; readonly cancel: () => void } {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    draw();
  }, SKELETON_AFTER_MS);
  return {
    slow: () => slow,
    cancel: () => clearTimeout(timer),
  };
}

export function errorOf(source: Watchable): ApiError | null {
  const error = source.error.peek();
  if (error === null || error === undefined) {
    return null;
  }
  if (error instanceof ApiError) {
    return error;
  }
  throw error;
}
