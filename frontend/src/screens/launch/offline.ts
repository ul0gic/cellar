import { html, render } from '@lightstart/light/html';
import { checkReachable } from '../../app/api.ts';
import { illustration } from '../../design-system/illustration.ts';
import { text } from '../../text/index.ts';

export const title = text('offline.title');

export function screen(): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-launch-offline';
  element.setAttribute('role', 'alert');
  render(
    html`<lc-empty-state heading-level="1" title=${text('offline.title')} description=${text('offline.body', { host: location.host })}>
      ${illustration('empty-lost')}
      <lc-button variant="primary" @click=${() => void checkReachable()}>${text('offline.retry')}</lc-button>
    </lc-empty-state>`,
    element,
  );
  return element;
}
