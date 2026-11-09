import type { LightElements } from '@lightstart/light/components/elements.js';
import { html, render, type TemplateResult } from '@lightstart/light/html';

const WIDE_QUERY = '(min-width: 1024px)';

export interface Sheet {
  readonly close: () => void;
  readonly redraw: () => void;
}

export interface SheetView {
  readonly body: TemplateResult;
  readonly footer: TemplateResult;
}

export function openSheet(title: string, view: (sheet: Sheet) => SheetView, closed?: () => void): Sheet {
  const host = document.createElement('div');
  const sheet: Sheet = {
    close: () => host.querySelector<LightElements['lc-modal']>('lc-modal')?.close(),
    redraw: () => draw(),
  };
  const draw = (): void => {
    const parts = view(sheet);
    render(
      html`<lc-modal
        open
        size="sm"
        variant=${matchMedia(WIDE_QUERY).matches ? 'default' : 'sheet'}
        class="cl-sheet"
        @modal-close=${() => {
          host.remove();
          closed?.();
        }}
      >
        <h2 slot="header" class="cl-sheet-title">${title}</h2>
        ${parts.body}
        <div slot="footer" class="cl-sheet-actions">${parts.footer}</div>
      </lc-modal>`,
      host,
    );
  };
  document.body.append(host);
  draw();
  return sheet;
}
