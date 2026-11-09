import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import './sheet.css';

export interface SheetOptions {
  readonly heading: () => string;
  readonly body: () => TemplateResult;
  readonly footer?: () => TemplateResult;
  readonly centered?: boolean;
  readonly onClose?: () => void;
}

export interface Sheet {
  readonly redraw: () => void;
  readonly close: () => void;
}

export function openSheet(opts: SheetOptions): Sheet {
  const host = document.createElement('div');
  let open = true;
  const draw = (): void => {
    render(
      html`<lc-modal
        class="cl-sheet"
        variant=${opts.centered === true ? 'default' : 'sheet'}
        size=${opts.centered === true ? 'lg' : 'md'}
        ?open=${open}
        @modal-close=${() => {
          host.remove();
          opts.onClose?.();
        }}
      >
        <h2 slot="header" class="cl-sheet-title">${opts.heading()}</h2>
        <div class="cl-sheet-body">${opts.body()}</div>
        ${opts.footer === undefined ? nothing : html`<div slot="footer" class="cl-sheet-footer">${opts.footer()}</div>`}
      </lc-modal>`,
      host,
    );
  };
  document.body.append(host);
  draw();
  return {
    redraw: draw,
    close: () => {
      open = false;
      draw();
    },
  };
}
