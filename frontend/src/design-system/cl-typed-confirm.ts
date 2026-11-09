import { defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import type { LightElements } from '@lightstart/light/components/elements.js';
import T from '@lightstart/light/types';
import { text } from '../text/index.ts';
import './cl-typed-confirm.css';

type Modal = LightElements['lc-modal'];

let instances = 0;

export function phraseMatches(typed: string, phrase: string): boolean {
  return typed.trim().toLowerCase() === phrase.trim().toLowerCase();
}

export const clTypedConfirm = defineComponent({
  tag: 'cl-typed-confirm',
  style: true,
  props: {
    open: false,
    heading: '',
    message: '',
    phrase: '',
    confirmLabel: '',
    cancelLabel: '',
    typed: '',
    _id: T.string({ reactive: false, defaultValue: '' }),
    _confirmed: T.boolean({ reactive: false, defaultValue: false }),
  },
  events: {
    answer: T.object(),
  },
  connected() {
    if (this._id === '') {
      instances += 1;
      this._id = `cl-typed-confirm-${instances}`;
    }
  },
  _close(confirmed: boolean) {
    this._confirmed = confirmed;
    this.querySelector<Modal>('lc-modal')?.close();
  },
  render() {
    const fieldId = `${this._id}-field`;
    const ready = phraseMatches(this.typed, this.phrase);
    return html`
      <lc-modal
        ?open=${this.open}
        size="sm"
        .closeOnBackdropClick=${false}
        @modal-close=${() => {
          this.open = false;
          this.$emit('answer', { confirmed: this._confirmed });
        }}
      >
        <h2 slot="header" part="cl-typed-confirm-title">${this.heading}</h2>
        <p part="cl-typed-confirm-message">${this.message}</p>
        <label part="cl-typed-confirm-label" for=${fieldId}>${text('dialog.typeToConfirm', { phrase: this.phrase })}</label>
        <input
          id=${fieldId}
          part="cl-typed-confirm-field"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          .value=${this.typed}
          @input=${(event: InputEvent) => {
            if (event.currentTarget instanceof HTMLInputElement) {
              this.typed = event.currentTarget.value;
            }
          }}
        />
        <div slot="footer" part="cl-typed-confirm-actions">
          <lc-button variant="quiet" @click=${() => this._close(false)}>${this.cancelLabel || text('action.cancel')}</lc-button>
          <lc-button variant="danger" ?disabled=${!ready} @click=${() => ready && this._close(true)}>${this.confirmLabel}</lc-button>
        </div>
      </lc-modal>
    `;
  },
});
