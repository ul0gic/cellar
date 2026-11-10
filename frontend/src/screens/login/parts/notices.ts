import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import '../../../design-system/lc/alert.ts';
import { formatDate } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';
import { nextPath } from './handoff.ts';

export function arrivalNotice(query: URLSearchParams): TemplateResult | typeof nothing {
  const restored = query.get('restored');
  if (restored !== null && !Number.isNaN(Date.parse(restored))) {
    return html`<lc-alert class="cl-stage-banner" variant="info"
      >${text('login.restored', { date: formatDate(restored) })}</lc-alert
    >`;
  }
  if (nextPath(query) !== '/') {
    return html`<lc-alert class="cl-stage-banner" variant="info">${text('signedOut.notice')}</lc-alert>`;
  }
  return nothing;
}
