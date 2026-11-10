import { type Computed, computed } from '@lightstart/light/signals';
import type { ApiError } from './api.ts';

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
