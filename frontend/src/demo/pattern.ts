import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import '../design-system/lc/button.ts';
import './pattern-form.ts';
import './pattern-overlays.ts';
import './pattern-resource.ts';

export const tag = 'cl-demo-pattern';

class DemoPattern extends View {
  readonly hostPresent = signal(true);

  render() {
    return html`
      <section aria-labelledby="demo-resource">
        <h2 id="demo-resource">Resource and load state</h2>
        <cl-demo-resource></cl-demo-resource>
      </section>
      <section aria-labelledby="demo-form">
        <h2 id="demo-form">Form</h2>
        <cl-demo-form></cl-demo-form>
      </section>
      <section aria-labelledby="demo-overlays">
        <h2 id="demo-overlays">Controller part, overlays and the host</h2>
        <lc-button @click=${() => {
          this.hostPresent.value = !this.hostPresent.value;
        }}>${this.hostPresent.value ? 'Remove the host for good' : 'Add the host'}</lc-button>
        ${this.hostPresent.value ? html`<cl-demo-overlays></cl-demo-overlays>` : nothing}
      </section>
    `;
  }
}

View.register(tag, DemoPattern);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: DemoPattern;
  }
}
