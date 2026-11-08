import { html, render } from '@lightstart/light/html';
import type { ScreenContext } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { text } from '../../text/index.ts';

export const title = text('notFound.screen');

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-launch-screen';
  render(
    html`<lc-empty-state title=${text('notFound.title')} description=${text('notFound.body', { path: ctx.params.path ?? '/' })}>
      ${illustration('empty-lost')}
      <lc-button variant="primary" href="/">${text('notFound.home')}</lc-button>
      <lc-button variant="quiet" href="/search">${text('notFound.search')}</lc-button>
    </lc-empty-state>`,
    element,
  );
  return element;
}
