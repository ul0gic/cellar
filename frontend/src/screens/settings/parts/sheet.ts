import type { LightElements } from '@lightstart/components/elements.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { viewport } from '../../../app/controllers/viewport.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { hostOverlay } from '../../../design-system/overlay.ts';
import '../../../design-system/lc/modal.ts';

export interface Sheet {
  readonly close: () => void;
}

export interface SheetView {
  readonly body: TemplateResult;
  readonly footer: TemplateResult;
}

interface SheetOptions {
  readonly heading: string;
  readonly view: () => SheetView;
  readonly onClose: () => void;
}

const tag = 'cl-settings-sheet';

class SettingsSheet extends View {
  options: SheetOptions | null = null;

  render() {
    const { options } = this;
    if (options === null) {
      return nothing;
    }
    const parts = options.view();
    return html`<lc-modal
      open
      size="sm"
      variant=${viewport.wide.peek() ? 'default' : 'sheet'}
      class="cl-sheet"
      @modal-close=${() => options.onClose()}
    >
      <h2 slot="header" class="cl-sheet-title">${options.heading}</h2>
      ${parts.body}
      <div slot="footer" class="cl-sheet-actions">${parts.footer}</div>
    </lc-modal>`;
  }
}

View.register(tag, SettingsSheet);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsSheet;
  }
}

export function openSheet(host: OverlayHost, title: string, view: () => SheetView, closed?: () => void): Sheet {
  const sheet = document.createElement(tag);
  sheet.options = {
    heading: title,
    view,
    onClose: () => {
      end();
      closed?.();
    },
  };
  const end = hostOverlay(host, sheet);
  return {
    close: () => {
      if (sheet.isConnected) {
        sheet.querySelector<LightElements['lc-modal']>('lc-modal')?.close();
      }
    },
  };
}
