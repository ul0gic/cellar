import { html, render, type TemplateResult } from '@lightstart/light/html';
import { text } from '../text/index.ts';
import { prefersReducedMotion } from './motion.ts';
import './lc/skeleton.ts';

export type SkeletonShape = 'cards' | 'rows' | 'figure' | 'lines';

const CARD_COUNT = 4;
const ROW_COUNT = 6;

function blocks(shape: SkeletonShape, animated: boolean): TemplateResult {
  switch (shape) {
    case 'cards':
      return html`<div class="cl-skeleton-cards">
        ${Array.from(
          { length: CARD_COUNT },
          () => html`<div class="cl-skeleton-card">
          <lc-skeleton variant="rounded" height="auto" class="cl-skeleton-media" .animated=${animated}></lc-skeleton>
          <lc-skeleton count="2" height="var(--skeleton-line)" .animated=${animated}></lc-skeleton>
        </div>`,
        )}
      </div>`;
    case 'rows':
      return html`<div class="cl-skeleton-rows">
        ${Array.from(
          { length: ROW_COUNT },
          () => html`<div class="cl-skeleton-row">
          <lc-skeleton variant="rounded" width="var(--thumb)" height="var(--thumb)" .animated=${animated}></lc-skeleton>
          <lc-skeleton count="2" height="var(--skeleton-line)" .animated=${animated}></lc-skeleton>
        </div>`,
        )}
      </div>`;
    case 'figure':
      return html`<lc-skeleton variant="rounded" width="40%" height="var(--text-4xl)" .animated=${animated}></lc-skeleton>`;
    case 'lines':
      return html`<lc-skeleton count="4" height="var(--skeleton-line)" .animated=${animated}></lc-skeleton>`;
  }
}

export function skeleton(shape: SkeletonShape, screen: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'cl-skeleton';
  container.setAttribute('aria-busy', 'true');
  render(
    html`<p class="cl-vh" role="status">${text('loading.screen', { screen })}</p>${blocks(shape, !prefersReducedMotion())}`,
    container,
  );
  return container;
}
