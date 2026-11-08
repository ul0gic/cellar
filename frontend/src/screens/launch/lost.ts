import { html, render } from '@lightstart/light/html';
import type { ScreenContext } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { text } from '../../text/index.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-launch-screen';
  render(
    html`<lc-empty-state
      title=${text('loadFailed.title', { screen: ctx.params.screen ?? text('app.name') })}
      description=${text('loadFailed.body')}
    >
      ${illustration('empty-lost')}
      <lc-button variant="primary" @click=${() => location.reload()}>${text('loadFailed.retry')}</lc-button>
    </lc-empty-state>`,
    element,
  );
  return element;
}
