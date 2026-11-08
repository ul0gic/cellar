import { text } from '../text/index.ts';

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

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const dialog = document.createElement('lc-alert-dialog');
  dialog.title = opts.title;
  dialog.message = opts.message;
  dialog.confirmText = opts.confirmLabel;
  dialog.cancelText = opts.cancelLabel ?? text('action.cancel');
  dialog.showCancel = true;
  dialog.confirmVariant = opts.danger === true ? 'danger' : 'default';
  return new Promise((resolve) => {
    const settle = (answer: boolean): void => {
      dialog.remove();
      resolve(answer);
    };
    dialog.addEventListener('confirm', () => settle(true), { once: true });
    dialog.addEventListener('cancel', () => settle(false), { once: true });
    document.body.append(dialog);
    dialog.open = true;
  });
}

export function confirmTyped(opts: ConfirmTypedOptions): Promise<boolean> {
  const dialog = document.createElement('cl-typed-confirm');
  dialog.setAttribute('heading', opts.title);
  dialog.setAttribute('message', opts.message);
  dialog.setAttribute('phrase', opts.phrase);
  dialog.setAttribute('confirm-label', opts.confirmLabel);
  dialog.setAttribute('cancel-label', opts.cancelLabel ?? text('action.cancel'));
  return new Promise((resolve) => {
    dialog.addEventListener(
      'answer',
      (event) => {
        dialog.remove();
        resolve(event instanceof CustomEvent && event.detail?.confirmed === true);
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.setAttribute('open', '');
  });
}
