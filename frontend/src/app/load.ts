import type { ResourceHandle } from '@lightstart/light/controller';
import { type Computed, computed } from '@lightstart/light/signals';
import { ApiError } from './api.ts';
import { hold, SKELETON_DELAY_MS } from './resources.ts';
import { router } from './router.ts';

export type LoadPhase = 'loading' | 'slow' | 'failed' | 'ready';

export interface LoadSource {
  readonly value: { readonly value: unknown; peek(): unknown };
  readonly error: Computed<ApiError | null>;
  readonly slow: Computed<boolean>;
  refresh(): Promise<void>;
}

export interface LoadState {
  readonly phase: Computed<LoadPhase>;
  readonly error: Computed<ApiError | null>;
  retry(): void;
}

export interface WatchState {
  readonly phase: LoadPhase;
  readonly slow: boolean;
  error(resource: ResourceHandle): ApiError | null;
  retry(): void;
}

export function loadState(resources: readonly LoadSource[]): LoadState {
  const missing = (): readonly LoadSource[] => resources.filter((source) => source.value.value === undefined);
  const phase = computed<LoadPhase>(() => {
    const waiting = missing();
    if (waiting.length === 0) {
      return 'ready';
    }
    if (waiting.some((source) => source.error.value !== null)) {
      return 'failed';
    }
    return waiting.some((source) => source.slow.value) ? 'slow' : 'loading';
  });
  return {
    phase,
    error: computed(() => {
      if (phase.value !== 'failed') {
        return null;
      }
      return missing().find((source) => source.error.value !== null)?.error.value ?? null;
    }),
    retry: () => {
      for (const source of resources) {
        if (source.error.peek() !== null) {
          void source.refresh();
        }
      }
    },
  };
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
  draw: (state: WatchState) => void,
): Watched {
  const retrying = new Set<ResourceHandle>();
  const stops: (() => void)[] = [];
  let starting = true;
  let stopped = false;
  let flag = slowFlag(redraw);

  const errorOf = (resource: ResourceHandle): ApiError | null => (retrying.has(resource) ? null : apiErrorOf(resource));

  const state: WatchState = {
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
