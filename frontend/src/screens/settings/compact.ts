import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { session } from '../../app/controllers/session.ts';
import { apiResource } from '../../app/resources.ts';
import { SETTINGS_PAGES, type SettingsPage, settingsPath } from '../../app/routes.ts';
import { MORE_PAGES, signOut } from '../../app/shell.ts';
import type { SessionPerson } from '../../app/types.ts';
import { type TextKey, text } from '../../text/index.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/list-row.ts';
import '../../design-system/lc/tag.ts';
import './compact.css';

export const tag = 'cl-screen-settings-compact';

const PAGES: readonly { readonly path: string; readonly label: TextKey; readonly icon: string }[] = [
  { path: '/ingredients', label: 'nav.ingredients', icon: 'citrus' },
  { path: '/menus', label: 'nav.menus', icon: 'tv' },
  { path: '/wishlists', label: 'nav.wishlists', icon: 'gift' },
  ...MORE_PAGES,
];

const GROUPS: readonly { readonly group: SettingsPage['group']; readonly label: TextKey }[] = [
  { group: 'you', label: 'settings.group.you' },
  { group: 'household', label: 'settings.group.household' },
  { group: 'install', label: 'settings.group.install' },
];

function visible(page: SettingsPage, person: SessionPerson): boolean {
  return person.person.role === 'owner' || !page.ownerOnly;
}

class SettingsCompact extends View {
  readonly menus = apiResource('listMenus', ['menus']);

  connected(): void {
    this.classList.add('cl-more');
    this.menus.bind(this, { query: { pageSize: 1 } });
  }

  render() {
    const person = session.current.value;
    if (person === null) {
      return nothing;
    }
    const live = this.menus.value.value?.items.some((menu) => menu.live) ?? false;
    return html`
      <h1 class="cl-more-title">${text('nav.more')}</h1>
      <nav class="cl-more-list" aria-label=${text('nav.moreMenu')}>
        ${PAGES.map(
          (page) => html`<lc-list-row href=${page.path} icon=${page.icon} label=${text(page.label)} chevron>
            ${page.path === '/menus' && live ? html`<lc-tag slot="trailing">${text('nav.live')}</lc-tag>` : nothing}
          </lc-list-row>`,
        )}
      </nav>
      <h2 class="cl-more-heading">${text('nav.settings')}</h2>
      ${GROUPS.map(({ group, label }) => {
        const pages = SETTINGS_PAGES.filter((page) => page.group === group && visible(page, person));
        return pages.length === 0
          ? nothing
          : html`<section class="cl-more-group" aria-label=${text(label)}>
              ${pages.map(
                (page) =>
                  html`<lc-list-row href=${settingsPath(page.slug)} label=${text(page.label)} chevron></lc-list-row>`,
              )}
            </section>`;
      })}
      <lc-button variant="quiet" class="cl-more-signout" @click=${() => void signOut(person)}>
        <lc-icon name="log-out" aria-hidden="true"></lc-icon>
        ${person.requireLogin ? text('nav.signOut') : text('nav.switchPerson')}
      </lc-button>
    `;
  }
}

View.register(tag, SettingsCompact);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsCompact;
  }
}
