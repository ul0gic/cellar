import { html, render } from '@lightstart/light/html';
import { text } from '../../text/index.ts';

export function screen(): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-launch';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-label', text('launch.loading'));
  render(
    html`<p class="cl-wordmark cl-wordmark-lg"><span class="cl-mark" aria-hidden="true"></span>${text('app.name')}</p>
      <div class="cl-launch-bar" aria-hidden="true"><i></i></div>`,
    element,
  );
  return element;
}
