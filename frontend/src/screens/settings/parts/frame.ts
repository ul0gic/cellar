import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { watch } from '../../../app/load.ts';
import { resourceFor } from '../../../app/resources.ts';
import { href } from '../../../app/router.ts';
import { SETTINGS_PAGES, type SettingsPage, settingsPath } from '../../../app/routes.ts';
import { setAppBar } from '../../../app/shell.ts';
import type { ScreenContext, SessionPerson } from '../../../app/types.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { type TextKey, text } from '../../../text/index.ts';
import { loadFailed } from './load-failed.ts';
import './frame.css';

const GROUPS: readonly { readonly group: SettingsPage['group']; readonly label: TextKey }[] = [
  { group: 'you', label: 'settings.group.you' },
  { group: 'household', label: 'settings.group.household' },
  { group: 'install', label: 'settings.group.install' },
];

function visible(page: SettingsPage, session: SessionPerson): boolean {
  return session.person.role === 'owner' || !page.ownerOnly;
}

function nav(slug: string, session: SessionPerson): TemplateResult {
  return html`<nav class="cl-snav" aria-label=${text('nav.settings')}>
    ${GROUPS.map(({ group, label }) => {
      const pages = SETTINGS_PAGES.filter((page) => page.group === group && visible(page, session));
      return pages.length === 0
        ? nothing
        : html`<h2 class="cl-snav-group">${text(label)}</h2>
            ${pages.map(
              (page) =>
                html`<a href=${href(settingsPath(page.slug))} aria-current=${page.slug === slug ? 'page' : nothing}
                  >${text(page.label)}</a
                >`,
            )}`;
    })}
  </nav>`;
}

function loginOffBanner(session: SessionPerson): TemplateResult | typeof nothing {
  return session.requireLogin
    ? nothing
    : html`<lc-alert class="cl-settings-banner" variant="warning" title=${text('settings.loginOff.title')}
        >${text('settings.loginOff.body')}</lc-alert
      >`;
}

function ownerOnly(main: HTMLElement): void {
  const members = resourceFor('listMembers', {}, { tags: ['settings'] });
  watch(main, [members], ({ phase, retry }) => {
    if (phase === 'failed') {
      render(loadFailed(text('nav.settings'), retry), main);
      return;
    }
    const owner = members.peek()?.members.find((member) => member.role === 'owner');
    if (owner === undefined) {
      return;
    }
    render(
      html`<lc-empty-state
        title=${text('ownerOnly.title')}
        description=${text('ownerOnly.body', { owner: owner.name })}
      >
        ${illustration('empty-lost')}
        <lc-button variant="primary" href=${href('/more')}>${text('ownerOnly.back')}</lc-button>
      </lc-empty-state>`,
      main,
    );
  });
}

export function settingsPage(
  ctx: ScreenContext,
  slug: string,
  mount: (main: HTMLElement, session: SessionPerson) => void,
): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-settings';
  const main = document.createElement('div');
  main.className = 'cl-settings-page';
  const page = SETTINGS_PAGES.find((candidate) => candidate.slug === slug);

  const draw = (session: SessionPerson): void => {
    render(
      html`<h1 class="cl-settings-title">${text('nav.settings')}</h1>
        ${nav(slug, session)}
        <div class="cl-settings-column">${loginOffBanner(session)}${main}</div>`,
      element,
    );
  };

  const current = ctx.person.current();
  if (current !== null) {
    draw(current);
    if (page !== undefined && !visible(page, current)) {
      ownerOnly(main);
    } else {
      mount(main, current);
    }
  }
  let shown = false;
  const stop = ctx.person.subscribe((next) => {
    if (element.isConnected) {
      shown = true;
    } else if (shown) {
      stop();
      return;
    }
    if (next !== null) {
      draw(next);
    }
  });
  setAppBar({ back: '/more' });
  return element;
}
