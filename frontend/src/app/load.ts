import type { ResourceHandle } from '@lightstart/light/controller';
import { ApiError } from './api.ts';
import { hold } from './resources.ts';
import { router } from './router.ts';

// D-1 §8.26: skeletons appear only when a response takes longer than 300 ms.
const SKELETON_DELAY_MS = 300;

export type LoadPhase = 'loading' | 'slow' | 'failed' | 'ready';

export interface LoadState {
  readonly phase: LoadPhase;
  readonly slow: boolean;
  error(resource: ResourceHandle): ApiError | null;
  retry(): void;
}

export interface Watched {
  readonly redraw: () => void;
  readonly stop: () => void;
}

export function onLeave(element: HTMLElement, cleanup: () => void): () => void {
  const stop = router.subscribe(() => {
    if (!element.isConnected) {
      stop();
      cleanup();
    }
  });
  return stop;
}

export function slowFlag(draw: () => void): { readonly slow: () => boolean; readonly cancel: () => void } {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    draw();
  }, SKELETON_DELAY_MS);
  return {
    slow: () => slow,
    cancel: () => clearTimeout(timer),
  };
}

function apiErrorOf(resource: ResourceHandle): ApiError | null {
  const error = resource.error.peek();
  if (error === null || error === undefined) {
    return null;
  }
  if (error instanceof ApiError) {
    return error;
  }
  throw error;
}

function shownThroughSignal(error: unknown): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
}

export function watch(
  element: HTMLElement,
  resources: readonly ResourceHandle[],
  draw: (state: LoadState) => void,
): Watched {
  const retrying = new Set<ResourceHandle>();
  const stops: (() => void)[] = [];
  let starting = true;
  let stopped = false;
  let flag = slowFlag(redraw);

  const errorOf = (resource: ResourceHandle): ApiError | null => (retrying.has(resource) ? null : apiErrorOf(resource));

  const state: LoadState = {
    get phase() {
      if (resources.every((resource) => resource.peek() !== undefined)) {
        return 'ready';
      }
      if (resources.some((resource) => resource.peek() === undefined && errorOf(resource) !== null)) {
        return 'failed';
      }
      return flag.slow() ? 'slow' : 'loading';
    },
    get slow() {
      return flag.slow();
    },
    error: errorOf,
    retry: () => {
      flag.cancel();
      flag = slowFlag(redraw);
      for (const resource of resources) {
        if (apiErrorOf(resource) !== null) {
          load(resource, () => resource.refresh());
        }
      }
      redraw();
    },
  };

  function load(resource: ResourceHandle, run: () => Promise<unknown>): void {
    if (apiErrorOf(resource) === null) {
      run().catch(shownThroughSignal);
      return;
    }
    retrying.add(resource);
    run()
      .catch(shownThroughSignal)
      .finally(() => {
        retrying.delete(resource);
        redraw();
      });
  }

  function redraw(): void {
    if (!starting && !stopped) {
      draw(state);
    }
  }

  function stop(): void {
    stopped = true;
    leave();
    flag.cancel();
    for (const unsubscribe of stops.splice(0)) {
      unsubscribe();
    }
  }

  const leave = onLeave(element, stop);

  for (const resource of resources) {
    stops.push(hold(resource), resource.value.subscribe(redraw), resource.error.subscribe(redraw));
    load(resource, () => resource.ensure());
  }
  starting = false;
  redraw();
  return { redraw, stop };
}
