import { LIMITS, type Member } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import { html, nothing, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { watch } from '../../app/load.ts';
import { actionFailed, fieldError, problemText } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext, SessionPerson } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { settingsPage } from './parts/frame.ts';
import { loadFailed } from './parts/load-failed.ts';
import { openSheet } from './parts/sheet.ts';

interface OneTime {
  readonly name: string;
  readonly password: string;
}

function memberSheet(
  title: string,
  actionLabel: string,
  startName: string,
  askPassword: boolean,
  send: (name: string, password: string | null) => Promise<void>,
): void {
  let name = startName;
  let password = '';
  let nameError = '';
  let passwordError = '';
  let busy = false;
  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    nameError = trimmed.length === 0 ? text('settings.members.nameMissing') : '';
    passwordError = askPassword && password.length < LIMITS.password.min ? text('setup.weak') : '';
    if (nameError !== '' || passwordError !== '') {
      sheet.redraw();
      return;
    }
    busy = true;
    sheet.redraw();
    try {
      await send(trimmed, askPassword ? password : null);
      sheet.close();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'duplicate_name') {
        nameError = problemText(error);
      } else if (error instanceof ApiError && error.code === 'validation_failed') {
        nameError = fieldError(error, 'name');
        passwordError = fieldError(error, 'password');
      } else {
        actionFailed(error, () => void submit());
      }
    } finally {
      busy = false;
    }
    sheet.redraw();
  };
  const sheet = openSheet(title, () => ({
    body: html`<form
      class="cl-sheet-form"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!busy) {
          void submit();
        }
      }}
    >
      <lc-input
        label=${text('settings.members.name')}
        .value=${name}
        error-message=${nameError}
        @input=${(event: Event) => {
          name = eventText(event);
        }}
      ></lc-input>
      ${
        askPassword
          ? html`<div class="cl-field">
              <lc-input
                label=${text('settings.members.password')}
                type="password"
                autocomplete="new-password"
                .value=${password}
                error-message=${passwordError}
                hint=${text('settings.members.passwordHint')}
                @input=${(event: Event) => {
                  password = eventText(event);
                }}
              ></lc-input>
            </div>`
          : nothing
      }
    </form>`,
    footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button variant="primary" ?disabled=${busy} @click=${() => void submit()}>${actionLabel}</lc-button>`,
  }));
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'members', (main, session: SessionPerson) => {
    const members = resourceFor('listMembers', {}, { tags: ['settings'] });
    const owner = session.person.role === 'owner';
    let oneTime: OneTime | null = null;

    const reset = async (member: Member): Promise<void> => {
      const sure = await confirm({
        title: text('settings.members.resetTitle', { name: member.name }),
        message: text('settings.members.resetBody'),
        confirmLabel: text('settings.members.reset'),
      });
      if (!sure) {
        return;
      }
      try {
        const result = await call('resetMemberPassword', { params: { id: member.id } });
        oneTime = { name: member.name, password: result.temporaryPassword };
        invalidate('settings');
        redraw();
      } catch (error) {
        actionFailed(error, () => void reset(member));
      }
    };

    const remove = async (member: Member): Promise<void> => {
      const sure = await confirm({
        title: text('settings.members.removeTitle', { name: member.name }),
        message: text('settings.members.removeBody'),
        confirmLabel: text('settings.members.remove'),
        danger: true,
      });
      if (!sure) {
        return;
      }
      try {
        await call('removeMember', { params: { id: member.id } });
        invalidate('settings', 'notes', 'wishlists', 'stats');
      } catch (error) {
        actionFailed(error, () => void remove(member));
      }
    };

    const rename = (member: Member): void =>
      memberSheet(
        text('settings.members.renameTitle', { name: member.name }),
        text('settings.members.renameSave'),
        member.name,
        false,
        async (name) => {
          await call('updateMember', { params: { id: member.id }, body: { name } });
          invalidate('settings');
          await ctx.person.refresh();
        },
      );

    const add = (): void =>
      memberSheet(
        text('settings.members.addTitle'),
        text('settings.members.addSave'),
        '',
        session.requireLogin,
        async (name, password) => {
          await call('createMember', { body: { name, password } });
          invalidate('settings');
        },
      );

    const openMenu = (event: MouseEvent, member: Member): void => {
      const trigger = event.currentTarget;
      const menu = main.querySelector<LightElements['lc-dropdown']>(`#member-menu-${member.id}`);
      if (trigger instanceof Element && menu !== null) {
        menu.toggle(trigger);
      }
    };

    const row = (member: Member) => html`<div class="cl-srow">
      <lc-avatar shape="rounded" size="sm" name=${member.name} src=${member.avatar?.url ?? nothing}></lc-avatar>
      <span class="cl-srow-text"
        ><b>${member.name}</b
        ><span>${member.role === 'owner' ? text('settings.members.owner') : text('settings.members.member')}</span></span
      >
      ${
        owner && member.role !== 'owner'
          ? html`<lc-button
                variant="ghost"
                icon-only
                aria-haspopup="menu"
                aria-label=${text('settings.members.actions', { name: member.name })}
                @click=${(event: MouseEvent) => openMenu(event, member)}
                ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon
              ></lc-button>
              <lc-dropdown
                id=${`member-menu-${member.id}`}
                aria-label=${text('settings.members.actions', { name: member.name })}
                .items=${[
                  { label: text('settings.members.rename'), icon: 'pencil', onClick: () => rename(member) },
                  { label: text('settings.members.reset'), icon: 'key-round', onClick: () => void reset(member) },
                  {
                    label: text('settings.members.remove'),
                    icon: 'trash-2',
                    danger: true,
                    onClick: () => void remove(member),
                  },
                ]}
              ></lc-dropdown>`
          : nothing
      }
    </div>`;

    const reveal = (shown: OneTime) => html`<lc-alert
      class="cl-settings-banner"
      variant="info"
      icon="key-round"
      title=${text('settings.members.oneTimeTitle', { name: shown.name })}
    >
      ${text('settings.members.oneTimeBody')}
      <p class="cl-code">${shown.password}</p>
      <div class="cl-banner-actions">
        <lc-clipboard
          text=${shown.password}
          label=${text('settings.members.copy')}
          @copy=${() => toast({ title: text('settings.members.copied') })}
        ></lc-clipboard>
      </div>
    </lc-alert>`;

    const view = (list: readonly Member[]) => html`<section class="cl-sgroup" aria-labelledby="settings-members">
      <h2 id="settings-members">${text('settings.members')}</h2>
      <p>${text('settings.members.lead')}</p>
      ${oneTime === null ? nothing : reveal(oneTime)}
      <div class="cl-panel">${list.map(row)}</div>
      ${
        owner
          ? html`<div class="cl-actions">
              <lc-button variant="quiet" @click=${add}
                ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('settings.members.add')}</lc-button
              >
            </div>`
          : nothing
      }
    </section>`;

    const { redraw } = watch(main, [members], ({ phase, retry }) => {
      const list = members.peek();
      if (phase === 'failed') {
        render(loadFailed(text('settings.members'), retry), main);
      } else if (phase === 'slow') {
        render(skeleton('rows', text('settings.members')), main);
      } else if (phase === 'ready' && list !== undefined) {
        render(view(list.members), main);
      }
    });
  });
}
