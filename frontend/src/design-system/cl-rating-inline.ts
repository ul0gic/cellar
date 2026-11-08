import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { text } from '../text/index.ts';

const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function ratingInline(value: number | null): TemplateResult | typeof nothing {
  if (value === null) {
    return nothing;
  }
  const shown = oneDecimal.format(value);
  return html`<span class="cl-rating-inline" role="img" aria-label=${text('rating.value', { value: shown })}
    ><span aria-hidden="true">${shown}</span><lc-icon name="star" solid aria-hidden="true"></lc-icon
  ></span>`;
}
