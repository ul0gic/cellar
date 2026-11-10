import { html, type TemplateResult } from '@lightstart/light/html';
import { href } from '../../../app/router.ts';
import { today } from '../../../app/today.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/icon.ts';
import { formatDate } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';
import './print.css';

export function toolbar(back: string): TemplateResult {
  return html`<div class="cl-print-toolbar">
    <lc-button variant="quiet" href=${href(back)}>
      <lc-icon name="chevron-left" aria-hidden="true"></lc-icon>${text('action.back')}
    </lc-button>
    <lc-button variant="primary" @click=${() => window.print()}>
      <lc-icon name="printer" aria-hidden="true"></lc-icon>${text('print.print')}
    </lc-button>
  </div>`;
}

export function printedOn(): TemplateResult {
  return html`<p class="cl-print-foot">${text('print.printedOn', { date: formatDate(today()) })}</p>`;
}
