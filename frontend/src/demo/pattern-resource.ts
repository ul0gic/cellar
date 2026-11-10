import View from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { loadState } from '../app/load.ts';
import { apiResource } from '../app/resources.ts';
import '../design-system/lc/button.ts';
import { loadFailed, waiting } from '../design-system/load-view.ts';

export const tag = 'cl-demo-resource';

const MISSING_MENU = 999_999;
const FIRST_MENU = 1;

class DemoResource extends View {
  readonly attempts = signal(0);
  readonly menu = apiResource('getMenu', ['menus']);
  readonly state = loadState([this.menu]);

  connected(): void {
    this.menu.bind(this, () => ({ params: { id: this.attempts.value === 0 ? MISSING_MENU : FIRST_MENU } }));
  }

  retry(): void {
    if (this.attempts.value === 0) {
      this.attempts.value = 1;
      return;
    }
    this.state.retry();
  }

  render() {
    const phase = this.state.phase.value;
    return html`
      <p>Phase: ${phase}. The first read asks for a menu that does not exist; Retry asks for menu 1 (sign in first).</p>
      ${
        phase === 'failed'
          ? loadFailed('Demo', () => this.retry(), 'none')
          : (waiting(this.state, 'Demo', 'lines') ?? html`<p>Ready: ${this.menu.value.value?.name}</p>`)
      }
      <lc-button variant="quiet" @click=${() => {
        this.attempts.value = 0;
      }}>Start over</lc-button>
    `;
  }
}

View.register(tag, DemoResource);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: DemoResource;
  }
}
