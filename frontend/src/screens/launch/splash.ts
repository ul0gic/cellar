import View from '@lightstart/light';
import { html } from '@lightstart/light/html';
import type { RouteParams } from '../../app/types.ts';
import { text } from '../../text/index.ts';

export const tag = 'cl-screen-launch-splash';

class LaunchSplash extends View {
  params: RouteParams = {};

  connected(): void {
    this.classList.add('cl-launch');
    this.setAttribute('role', 'status');
    this.setAttribute('aria-label', text('launch.loading'));
  }

  render() {
    return html`<p class="cl-wordmark cl-wordmark-lg"><span class="cl-mark" aria-hidden="true"></span>${text('app.name')}</p>
      <div class="cl-launch-bar" aria-hidden="true"><i></i></div>`;
  }
}

View.register(tag, LaunchSplash);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: LaunchSplash;
  }
}
