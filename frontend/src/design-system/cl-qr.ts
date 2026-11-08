import { defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { encode } from 'uqr';
import { text } from '../text/index.ts';
import './cl-qr.css';

function modulePath(rows: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  for (const [y, row] of rows.entries()) {
    for (const [x, dark] of row.entries()) {
      if (dark) {
        parts.push(`M${x} ${y}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}

export const clQr = defineComponent({
  tag: 'cl-qr',
  style: true,
  props: {
    value: '',
    label: '',
  },
  render() {
    const { data, size } = encode(this.value, { ecc: 'M', border: 0 });
    return html`<svg
      part="cl-qr-code"
      viewBox=${`0 0 ${size} ${size}`}
      role="img"
      aria-label=${this.label || text('qr.label')}
      shape-rendering="crispEdges"
    ><path d=${modulePath(data)}></path></svg>`;
  },
});
