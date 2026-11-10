import View from '@lightstart/light';
import { html } from '@lightstart/light/html';
import type { RouteParams } from '../../app/types.ts';
import { checkReachable } from '../../app/api.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import { illustration } from '../../design-system/illustration.ts';
import { text } from '../../text/index.ts';

export const tag = 'cl-screen-launch-offline';
export const title = text('offline.title');

class LaunchOffline extends View {
  params: RouteParams = {};

  connected(): void {
    this.classList.add('cl-launch-offline');
    this.setAttribute('role', 'alert');
  }

  render() {
    return html`<lc-empty-state heading-level="1" title=${text('offline.title')} description=${text('offline.body', { host: location.host })}>
      ${illustration('empty-lost')}
      <lc-button variant="primary" @click=${() => void checkReachable()}>${text('offline.retry')}</lc-button>
    </lc-empty-state>`;
  }
}

View.register(tag, LaunchOffline);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: LaunchOffline;
  }
}
