import { html, type TemplateResult } from '@lightstart/light/html';
import { ApiError } from '../../../app/api.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { text } from '../../../text/index.ts';

// D-1 §8.26: skeletons appear only after 300 ms; a faster answer paints directly.
const SKELETON_AFTER_MS = 300;

export interface Watchable {
  ensure(): Promise<unknown>;
  subscribe(callback: () => void): () => void;
}

export type WatchState = 'loading' | 'slow' | 'failed' | 'ready';

export interface Watched {
  readonly state: WatchState;
  readonly retry: () => void;
}

export function watch(
  element: HTMLElement,
  resources: readonly Watchable[],
  draw: (watched: Watched) => void,
): () => void {
  let state: WatchState = 'loading';
  let shown = false;
  const stops: (() => void)[] = [];
  const redraw = (): void => draw({ state, retry: () => void load() });
  const live = (): boolean => {
    if (element.isConnected) {
      shown = true;
      return true;
    }
    if (shown) {
      for (const stop of stops.splice(0)) {
        stop();
      }
    }
    return false;
  };
  const load = async (): Promise<void> => {
    state = 'loading';
    redraw();
    const timer = setTimeout(() => {
      if (state === 'loading') {
        state = 'slow';
        redraw();
      }
    }, SKELETON_AFTER_MS);
    try {
      await Promise.all(resources.map((resource) => resource.ensure()));
      state = 'ready';
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      state = 'failed';
    } finally {
      clearTimeout(timer);
    }
    redraw();
  };
  for (const resource of resources) {
    stops.push(
      resource.subscribe(() => {
        if (state === 'ready' && live()) {
          redraw();
        }
      }),
    );
  }
  void load();
  return redraw;
}

export function loadFailed(screen: string, retry: () => void): TemplateResult {
  return html`<lc-empty-state title=${text('loadFailed.title', { screen })} description=${text('loadFailed.body')}>
    ${illustration('empty-lost')}
    <lc-button variant="primary" @click=${retry}>
      <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('loadFailed.retry')}
    </lc-button>
  </lc-empty-state>`;
}
