import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import type { LoadState } from '../app/load.ts';
import { text } from '../text/index.ts';
import { illustration } from './illustration.ts';
import { type SkeletonShape, skeleton } from './skeleton.ts';
import './lc/button.ts';
import './lc/empty-state.ts';
import './lc/icon.ts';

export function loadFailed(screen: string, retry: () => void, icon: 'refresh' | 'none'): TemplateResult {
  if (icon === 'refresh') {
    return html`<lc-empty-state title=${text('loadFailed.title', { screen })} description=${text('loadFailed.body')}>
    ${illustration('empty-lost')}
    <lc-button variant="primary" @click=${retry}>
      <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('loadFailed.retry')}
    </lc-button>
  </lc-empty-state>`;
  }
  return html`<lc-empty-state title=${text('loadFailed.title', { screen })} description=${text('loadFailed.body')}>
    ${illustration('empty-lost')}
    <lc-button variant="primary" @click=${retry}>${text('loadFailed.retry')}</lc-button>
  </lc-empty-state>`;
}

export function waiting(
  state: LoadState,
  screen: string,
  shape: SkeletonShape,
): TemplateResult | typeof nothing | HTMLElement | null {
  switch (state.phase.value) {
    case 'ready':
      return null;
    case 'failed':
      return loadFailed(screen, state.retry, 'none');
    case 'slow':
      return skeleton(shape, screen);
    case 'loading':
      return nothing;
  }
}
