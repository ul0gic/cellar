import { toasts } from '@lightstart/light/components/feedback/toasts.js';

export interface ToastOptions {
  readonly title: string;
  readonly message?: string;
  readonly variant?: 'status' | 'error';
  readonly action?: { readonly label: string; readonly run: () => void };
}

// D-1 §8.23: 5 s for a confirmation, 10 s with an action, errors stay until dismissed.
const PLAIN_MS = 5000;
const ACTION_MS = 10_000;
const UNTIL_DISMISSED = 0;

export function toast(opts: ToastOptions): void {
  const error = opts.variant === 'error';
  toasts.hideAll();
  toasts.show({
    title: opts.title,
    message: opts.action?.label ?? opts.message ?? '',
    variant: error ? 'error' : 'default',
    duration: error ? UNTIL_DISMISSED : opts.action === undefined ? PLAIN_MS : ACTION_MS,
    ...(opts.action === undefined ? {} : { onTap: opts.action.run }),
  });
}
