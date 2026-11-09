import type { Resource } from '@lightstart/light/controller';
import { ApiError } from '../../app/api.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';

// D-1 §8.26: skeletons appear only when a response takes longer than 300 ms.
const SKELETON_DELAY_MS = 300;

export type LoadState = 'waiting' | 'slow' | 'failed' | 'ready';

export function actionFailed(error: unknown, retry: () => void): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (error.code === 'network_error') {
    toast({
      title: text('saveFailed.title'),
      variant: 'error',
      action: { label: text('saveFailed.retry'), run: retry },
    });
    return;
  }
  toast({ title: error.detail, variant: 'error' });
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function watchResource<T>(
  element: HTMLElement,
  resource: Resource<T>,
  draw: (state: LoadState, value: T | undefined, error: ApiError | null) => void,
): () => void {
  let state: LoadState = 'waiting';
  let failure: ApiError | null = null;
  let shown = false;

  const redraw = (): void => draw(state, resource.peek(), failure);
  const fail = (error: unknown): void => {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    failure = error;
    state = 'failed';
    redraw();
  };

  setTimeout(() => {
    if (state === 'waiting') {
      state = 'slow';
      redraw();
    }
  }, SKELETON_DELAY_MS);

  const stop = resource.subscribe((value) => {
    if (element.isConnected) {
      shown = true;
    } else if (shown) {
      stop();
      return;
    }
    if (value !== undefined) {
      state = 'ready';
      failure = null;
    }
    redraw();
  });
  void resource.ensure().catch(fail);

  return () => {
    state = 'slow';
    failure = null;
    redraw();
    void resource.refresh().catch(fail);
  };
}
