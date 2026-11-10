import type { OverlayHost } from '../app/types.ts';

export function hostOverlay(host: OverlayHost, element: HTMLElement, onRemove?: () => void): () => void {
  let ended = false;
  const end = (): void => {
    if (ended) {
      return;
    }
    ended = true;
    element.remove();
    onRemove?.();
  };
  const follow = (): void => {
    host.$own(() => {
      queueMicrotask(() => {
        if (ended) {
          return;
        }
        if (host.isConnected) {
          follow();
        } else {
          end();
        }
      });
    });
  };
  document.body.append(element);
  follow();
  return end;
}
