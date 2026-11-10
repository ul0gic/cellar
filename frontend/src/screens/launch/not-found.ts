import View from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { href } from '../../app/router.ts';
import type { RouteParams } from '../../app/types.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import { illustration } from '../../design-system/illustration.ts';
import { text } from '../../text/index.ts';

export const tag = 'cl-screen-launch-not-found';
export const title = text('notFound.screen');

class LaunchNotFound extends View {
  params: RouteParams = {};

  connected(): void {
    this.classList.add('cl-launch-screen');
  }

  render() {
    return html`<lc-empty-state title=${text('notFound.title')} description=${text('notFound.body', { path: this.params.path ?? '/' })}>
      ${illustration('empty-lost')}
      <lc-button variant="primary" href=${href('/')}>${text('notFound.home')}</lc-button>
      <lc-button variant="quiet" href=${href('/search')}>${text('notFound.search')}</lc-button>
    </lc-empty-state>`;
  }
}

View.register(tag, LaunchNotFound);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: LaunchNotFound;
  }
}
