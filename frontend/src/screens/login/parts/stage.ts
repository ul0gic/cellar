import { html, type TemplateResult } from '@lightstart/light/html';
import { text } from '../../../text/index.ts';
import '../../settings/parts/frame.css';
import './stage.css';

export function stage(content: TemplateResult): TemplateResult {
  return html`<div class="cl-stage">
    <p class="cl-wordmark cl-wordmark-lg cl-stage-mark"><span class="cl-mark" aria-hidden="true"></span>${text('app.name')}</p>
    ${content}
  </div>`;
}

export function cardForm(content: TemplateResult): TemplateResult {
  return stage(html`<div class="cl-card-form">${content}</div>`);
}

export function stepDots(step: number, of: number): TemplateResult {
  return html`<p class="cl-stepdots">
    <span class="cl-vh">${text('login.step', { step, of })}</span>
    ${Array.from({ length: of }, (_, index) => html`<i class=${index < step ? 'is-on' : ''} aria-hidden="true"></i>`)}
  </p>`;
}
