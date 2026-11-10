import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import type { OverlayHost } from '../../../app/types.ts';
import { hostOverlay } from '../../../design-system/overlay.ts';
import '../../../design-system/lc/modal.ts';
import './sheet.css';

export interface SheetOptions {
  readonly heading: () => string;
  readonly body: () => TemplateResult;
  readonly footer?: () => TemplateResult;
  readonly centered?: boolean;
  readonly onClose?: () => void;
}

export interface Sheet {
  readonly close: () => void;
}

const tag = 'cl-recipes-sheet';

class RecipesSheet extends View {
  options: SheetOptions | null = null;

  render() {
    const { options } = this;
    if (options === null) {
      return nothing;
    }
    return html`<lc-modal
      class="cl-sheet"
      variant=${options.centered === true ? 'default' : 'sheet'}
      size=${options.centered === true ? 'lg' : 'md'}
      open
      @modal-close=${() => options.onClose?.()}
    >
      <h2 slot="header" class="cl-sheet-title">${options.heading()}</h2>
      <div class="cl-sheet-body">${options.body()}</div>
      ${options.footer === undefined ? nothing : html`<div slot="footer" class="cl-sheet-footer">${options.footer()}</div>`}
    </lc-modal>`;
  }
}

View.register(tag, RecipesSheet);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: RecipesSheet;
  }
}

export function openSheet(host: OverlayHost, opts: SheetOptions): Sheet {
  const sheet = document.createElement(tag);
  sheet.options = {
    ...opts,
    onClose: () => {
      end();
      opts.onClose?.();
    },
  };
  const end = hostOverlay(host, sheet);
  return { close: end };
}
