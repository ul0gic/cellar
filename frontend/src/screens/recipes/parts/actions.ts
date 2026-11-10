import type { DropdownItem } from '@lightstart/components/types.js';
import { html, nothing } from '@lightstart/light/html';
import { viewport } from '../../../app/controllers/viewport.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { hostOverlay } from '../../../design-system/overlay.ts';
import '../../../design-system/lc/dropdown.ts';
import '../../../design-system/lc/icon.ts';
import { openSheet } from './sheet.ts';

export function openActions(
  host: OverlayHost,
  trigger: Element,
  heading: string,
  items: readonly DropdownItem[],
): void {
  if (viewport.wide.peek()) {
    const menu = document.createElement('lc-dropdown');
    menu.className = 'cl-actions-menu';
    menu.items = [...items];
    const end = hostOverlay(host, menu);
    menu.addEventListener('popover-close', end, { once: true });
    requestAnimationFrame(() => {
      if (menu.isConnected) {
        menu.toggle(trigger);
      }
    });
    return;
  }
  const sheet = openSheet(host, {
    heading: () => heading,
    body: () => html`<div class="cl-action-sheet" role="menu" aria-label=${heading}>
      ${items.map((item) =>
        item.divider === true
          ? html`<hr class="cl-action-sheet-rule" />`
          : html`<button
              type="button"
              role="menuitem"
              class=${item.danger === true ? 'cl-action-sheet-item is-danger' : 'cl-action-sheet-item'}
              ?disabled=${item.disabled === true}
              @click=${(event: Event) => {
                sheet.close();
                item.onClick?.(event);
              }}
            >
              ${item.icon === undefined ? nothing : html`<lc-icon name=${item.icon} aria-hidden="true"></lc-icon>`}
              <span>${item.label}</span>
            </button>`,
      )}
    </div>`,
  });
}
