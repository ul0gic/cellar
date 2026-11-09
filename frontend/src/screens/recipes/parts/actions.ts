import type { DropdownItem } from '@lightstart/light/components/types.js';
import { html, nothing } from '@lightstart/light/html';
import { openSheet } from './sheet.ts';

const WIDE = matchMedia('(min-width: 1024px)');

export function isWide(): boolean {
  return WIDE.matches;
}

export function openActions(trigger: Element, heading: string, items: readonly DropdownItem[]): void {
  if (WIDE.matches) {
    const menu = document.createElement('lc-dropdown');
    menu.className = 'cl-actions-menu';
    menu.items = [...items];
    menu.addEventListener('popover-close', () => menu.remove(), { once: true });
    document.body.append(menu);
    requestAnimationFrame(() => menu.toggle(trigger));
    return;
  }
  const sheet = openSheet({
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
