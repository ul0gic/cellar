import { html, type TemplateResult } from '@lightstart/light/html';
import { illustration } from '../../../design-system/illustration.ts';
import { text } from '../../../text/index.ts';

export function loadFailed(screen: string, retry: () => void): TemplateResult {
  return html`<lc-empty-state title=${text('loadFailed.title', { screen })} description=${text('loadFailed.body')}>
    ${illustration('empty-lost')}
    <lc-button variant="primary" @click=${retry}>
      <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('loadFailed.retry')}
    </lc-button>
  </lc-empty-state>`;
}
