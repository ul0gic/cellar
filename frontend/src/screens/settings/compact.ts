import { html, nothing, render } from '@lightstart/light/html';
import { resourceFor } from '../../app/resources.ts';
import { SETTINGS_PAGES, type SettingsPage, settingsPath } from '../../app/routes.ts';
import { MORE_PAGES, signOut } from '../../app/shell.ts';
import type { ScreenContext, SessionPerson } from '../../app/types.ts';
import { type TextKey, text } from '../../text/index.ts';
import './compact.css';

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

function visible(page: SettingsPage, session: SessionPerson): boolean {
  return session.person.role === 'owner' || !page.ownerOnly;
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-more';
  const menus = resourceFor('listMenus', { query: { pageSize: 1 } }, { tags: ['menus'] });

  const draw = (): void => {
    const session = ctx.person.current();
    if (session === null) {
      return;
    }
    const live = menus.peek()?.items.some((menu) => menu.live) ?? false;
    render(
      html`
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
          const pages = SETTINGS_PAGES.filter((page) => page.group === group && visible(page, session));
          return pages.length === 0
            ? nothing
            : html`<section class="cl-more-group" aria-label=${text(label)}>
                ${pages.map(
                  (page) =>
                    html`<lc-list-row href=${settingsPath(page.slug)} label=${text(page.label)} chevron></lc-list-row>`,
                )}
              </section>`;
        })}
        <lc-button variant="quiet" class="cl-more-signout" @click=${() => void signOut(session)}>
          <lc-icon name="log-out" aria-hidden="true"></lc-icon>
          ${session.requireLogin ? text('nav.signOut') : text('nav.switchPerson')}
        </lc-button>
      `,
      element,
    );
  };

  let shown = false;
  const stop = menus.subscribe(() => {
    if (element.isConnected) {
      shown = true;
    } else if (shown) {
      stop();
      return;
    }
    draw();
  });
  void menus.ensure();
  return element;
}
