import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { session } from '../../../app/controllers/session.ts';
import { type LoadState, loadState } from '../../../app/load.ts';
import { apiResource } from '../../../app/resources.ts';
import { href } from '../../../app/router.ts';
import { SETTINGS_PAGES, type SettingsPage, settingsPath } from '../../../app/routes.ts';
import type { SessionPerson } from '../../../app/types.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { loadFailed } from '../../../design-system/load-view.ts';
import { type SkeletonShape, skeleton } from '../../../design-system/skeleton.ts';
import { type TextKey, text } from '../../../text/index.ts';
import '../../../design-system/lc/alert.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/empty-state.ts';
import './frame.css';

const ownerOnlyTag = 'cl-settings-frame-owner-only';

type Body = TemplateResult | HTMLElement | typeof nothing;

const GROUPS: readonly { readonly group: SettingsPage['group']; readonly label: TextKey }[] = [
  { group: 'you', label: 'settings.group.you' },
  { group: 'household', label: 'settings.group.household' },
  { group: 'install', label: 'settings.group.install' },
];

function visible(page: SettingsPage, person: SessionPerson): boolean {
  return person.person.role === 'owner' || !page.ownerOnly;
}

function nav(slug: string, person: SessionPerson): TemplateResult {
  return html`<nav class="cl-snav" aria-label=${text('nav.settings')}>
    ${GROUPS.map(({ group, label }) => {
      const pages = SETTINGS_PAGES.filter((page) => page.group === group && visible(page, person));
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

function loginOffBanner(person: SessionPerson): TemplateResult | typeof nothing {
  return person.requireLogin
    ? nothing
    : html`<lc-alert class="cl-settings-banner" variant="warning" title=${text('settings.loginOff.title')}
        >${text('settings.loginOff.body')}</lc-alert
      >`;
}

export function settingsReadable(slug: string): boolean {
  const person = session.current.peek();
  const page = SETTINGS_PAGES.find((candidate) => candidate.slug === slug);
  return person !== null && (page === undefined || visible(page, person));
}

export function settingsFrame(slug: string, body: () => Body): TemplateResult | typeof nothing {
  const person = session.current.value;
  if (person === null) {
    return nothing;
  }
  const page = SETTINGS_PAGES.find((candidate) => candidate.slug === slug);
  const content =
    page !== undefined && !visible(page, person)
      ? html`<cl-settings-frame-owner-only></cl-settings-frame-owner-only>`
      : body();
  return html`<h1 class="cl-settings-title">${text('nav.settings')}</h1>
    ${nav(slug, person)}
    <div class="cl-settings-column">${loginOffBanner(person)}<div class="cl-settings-page">${content}</div></div>`;
}

export function settingsLoad(state: LoadState, screen: string, shape: SkeletonShape): Body | null {
  switch (state.phase.value) {
    case 'ready':
      return null;
    case 'failed':
      return loadFailed(screen, state.retry, 'refresh');
    case 'slow':
      return skeleton(shape, screen);
    case 'loading':
      return nothing;
  }
}

class SettingsFrameOwnerOnly extends View {
  readonly members = apiResource('listMembers', ['settings']);
  readonly state = loadState([this.members]);

  connected(): void {
    this.members.bind(this, {});
  }

  render() {
    if (this.state.phase.value === 'failed') {
      return loadFailed(text('nav.settings'), this.state.retry, 'refresh');
    }
    const owner = this.members.value.value?.members.find((member) => member.role === 'owner');
    if (owner === undefined) {
      return nothing;
    }
    return html`<lc-empty-state
      title=${text('ownerOnly.title')}
      description=${text('ownerOnly.body', { owner: owner.name })}
    >
      ${illustration('empty-lost')}
      <lc-button variant="primary" href=${href('/more')}>${text('ownerOnly.back')}</lc-button>
    </lc-empty-state>`;
  }
}

View.register(ownerOnlyTag, SettingsFrameOwnerOnly);

declare global {
  interface HTMLElementTagNameMap {
    [ownerOnlyTag]: SettingsFrameOwnerOnly;
  }
}
