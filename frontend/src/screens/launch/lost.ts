import View from '@lightstart/light';
import { html } from '@lightstart/light/html';
import type { RouteParams } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { text } from '../../text/index.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';

export const tag = 'cl-screen-launch-lost';

class LaunchLost extends View {
  params: RouteParams = {};

  connected(): void {
    this.classList.add('cl-launch-screen');
  }

  render() {
    return html`<lc-empty-state
      title=${text('loadFailed.title', { screen: this.params.screen ?? text('app.name') })}
      description=${text('loadFailed.body')}
    >
      ${illustration('empty-lost')}
      <lc-button variant="primary" @click=${() => location.reload()}>${text('loadFailed.retry')}</lc-button>
    </lc-empty-state>`;
  }
}

View.register(tag, LaunchLost);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: LaunchLost;
  }
}
