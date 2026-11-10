import View from '@lightstart/light';
import { html, render } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { apiResource } from '../app/resources.ts';
import { confirm, confirmTyped } from '../design-system/dialogs.ts';
import '../design-system/lc/button.ts';
import { hostOverlay } from '../design-system/overlay.ts';
import { demoCounter } from './pattern-counter.ts';
import './pattern-readout.ts';

export const tag = 'cl-demo-overlays';

class DemoOverlays extends View {
  readonly typed = signal('');
  readonly answer = signal('none yet');
  readonly health = apiResource('healthcheck', []);

  connected(): void {
    this.health.bind(this, {});
    const readout = document.createElement('cl-demo-readout');
    document.body.append(readout);
    this.$own(() => readout.remove());
  }

  openSheet(): void {
    const sheet = document.createElement('div');
    sheet.className = 'cl-demo-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Demo sheet');
    const keepCurrent = effect(() => {
      render(
        html`<p>The host holds: ${this.typed.value || 'nothing typed'}</p>
          <input class="cl-demo-sheet-input" aria-label="Typed in the sheet" />
          <lc-button variant="quiet" @click=${() => close()}>Close sheet</lc-button>`,
        sheet,
      );
    });
    const close = hostOverlay(this, sheet, () => keepCurrent.dispose());
  }

  render() {
    return html`
      <div class="cl-demo-col">
        <label>Typed in the host <input .value=${this.typed.value} @input=${(event: InputEvent) => {
          if (event.currentTarget instanceof HTMLInputElement) {
            this.typed.value = event.currentTarget.value;
          }
        }} /></label>
        <p>Health read: ${this.health.value.value?.status ?? 'no value yet'}</p>
        <p>Last answer: ${this.answer.value}</p>
        <div class="cl-demo-row">
          <lc-button @click=${() => this.openSheet()}>Open sheet</lc-button>
          <lc-button
            @click=${() =>
              void confirm(this, { title: 'Demo confirm', message: 'Tied to this host.', confirmLabel: 'Yes' }).then(
                (answer) => {
                  this.answer.value = answer ? 'confirmed' : 'cancelled';
                },
              )}
          >Open confirm</lc-button>
          <lc-button
            @click=${() =>
              void confirmTyped(this, {
                title: 'Demo typed confirm',
                message: 'Type the phrase to continue.',
                phrase: 'demo',
                confirmLabel: 'Continue',
              }).then((answer) => {
                this.answer.value = answer ? 'typed confirmed' : 'typed cancelled';
              })}
          >Open typed confirm</lc-button>
          <lc-button @click=${() => demoCounter.bump()}>Bump the controller counter</lc-button>
          <lc-button @click=${() => this.reinsert()}>Re-insert host (the 1024 px flip)</lc-button>
        </div>
      </div>
    `;
  }

  reinsert(): void {
    const parent = this.parentNode;
    if (parent === null) {
      return;
    }
    const next = this.nextSibling;
    this.remove();
    parent.insertBefore(this, next);
  }
}

View.register(tag, DemoOverlays);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: DemoOverlays;
  }
}
