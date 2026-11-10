import type { OverlayHost } from '../app/types.ts';
import { text } from '../text/index.ts';
import './cl-typed-confirm.ts';
import { hostOverlay } from './overlay.ts';
import './lc/alert-dialog.ts';

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
}

export interface ConfirmTypedOptions {
  readonly title: string;
  readonly message: string;
  readonly phrase: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
}

export function confirm(host: OverlayHost, opts: ConfirmOptions): Promise<boolean> {
  const dialog = document.createElement('lc-alert-dialog');
  dialog.title = opts.title;
  dialog.message = opts.message;
  dialog.confirmText = opts.confirmLabel;
  dialog.cancelText = opts.cancelLabel ?? text('action.cancel');
  dialog.showCancel = true;
  dialog.confirmVariant = opts.danger === true ? 'danger' : 'default';
  return new Promise((resolve) => {
    const remove = hostOverlay(host, dialog, () => resolve(false));
    const settle = (answer: boolean): void => {
      resolve(answer);
      remove();
    };
    dialog.addEventListener('confirm', () => settle(true), { once: true });
    dialog.addEventListener('cancel', () => settle(false), { once: true });
    dialog.open = true;
  });
}

export function confirmTyped(host: OverlayHost, opts: ConfirmTypedOptions): Promise<boolean> {
  const dialog = document.createElement('cl-typed-confirm');
  dialog.heading = opts.title;
  dialog.message = opts.message;
  dialog.phrase = opts.phrase;
  dialog.confirmLabel = opts.confirmLabel;
  dialog.cancelLabel = opts.cancelLabel ?? text('action.cancel');
  return new Promise((resolve) => {
    const remove = hostOverlay(host, dialog, () => resolve(false));
    dialog.addEventListener(
      'answer',
      (event) => {
        resolve(event instanceof CustomEvent && event.detail?.confirmed === true);
        remove();
      },
      { once: true },
    );
    dialog.open = true;
  });
}
