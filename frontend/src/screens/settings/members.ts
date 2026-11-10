import { LIMITS, type Member } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, formErrors, problemText } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { formValues, valueText } from '../../app/events.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad } from './parts/frame.ts';
import { openSheet, type Sheet } from './parts/sheet.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/avatar.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/clipboard.ts';
import '../../design-system/lc/dropdown.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';

export const tag = 'cl-screen-settings-members';

interface OneTime {
  readonly name: string;
  readonly password: string;
}

const MEMBER_NAMES = ['name', 'password'];

const NAME_FIELD: FormField = { name: 'name', type: 'text', label: text('settings.members.name') };

const PASSWORD_FIELD: FormField = {
  name: 'password',
  type: 'password',
  label: text('settings.members.password'),
  help: text('settings.members.passwordHint'),
};

class SettingsMembers extends View {
  readonly members = apiResource('listMembers', ['settings']);
  readonly state = loadState([this.members]);
  readonly oneTime = signal<OneTime | null>(null);

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    this.members.bind(this, {});
  }

  private memberSheet(
    title: string,
    actionLabel: string,
    startName: string,
    askPassword: boolean,
    send: (name: string, password: string | null) => Promise<void>,
  ): void {
    const fieldValues = signal<Record<string, unknown>>({ name: startName });
    const fieldErrors = signal<Record<string, string>>({});
    const working = signal(false);
    const fields = askPassword ? [NAME_FIELD, PASSWORD_FIELD] : [NAME_FIELD];
    const submit = async (): Promise<void> => {
      const current = fieldValues.peek();
      const trimmed = valueText(current, 'name').trim();
      const password = valueText(current, 'password');
      const missing: Record<string, string> = {};
      if (trimmed.length === 0) {
        missing.name = text('settings.members.nameMissing');
      }
      if (askPassword && password.length < LIMITS.password.min) {
        missing.password = text('setup.weak');
      }
      fieldErrors.value = missing;
      if (Object.keys(missing).length > 0) {
        return;
      }
      working.value = true;
      try {
        await send(trimmed, askPassword ? password : null);
        sheet.close();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'duplicate_name') {
          fieldErrors.value = { name: problemText(error) };
        } else if (error instanceof ApiError && error.code === 'validation_failed') {
          fieldErrors.value = formErrors(error, MEMBER_NAMES).fields;
        } else {
          actionFailed(error, () => void submit());
        }
      } finally {
        working.value = false;
      }
    };
    const sheet: Sheet = openSheet(this, title, () => ({
      body: html`<lc-form
        class="cl-settings-form"
        layout="stacked"
        .fields=${fields}
        .data=${fieldValues.value}
        .errors=${fieldErrors.value}
        @field-change=${(event: Event) => {
          const next = formValues(event);
          if (next !== null) {
            fieldValues.value = next;
          }
        }}
        @form-submit=${() => {
          if (!working.peek()) {
            void submit();
          }
        }}
      ></lc-form>`,
      footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${working.value} @click=${() => void submit()}>${actionLabel}</lc-button>`,
    }));
  }

  private async reset(member: Member): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    const sure = await confirm(this, {
      title: text('settings.members.resetTitle', { name: member.name }),
      message: text('settings.members.resetBody'),
      confirmLabel: text('settings.members.reset'),
    });
    if (!sure) {
      return;
    }
    try {
      const result = await call('resetMemberPassword', { params: { id: member.id } });
      dataChanged('settings');
      if (this.isConnected) {
        this.oneTime.value = { name: member.name, password: result.temporaryPassword };
      }
    } catch (error) {
      actionFailed(error, () => void this.reset(member));
    }
  }

  private async removeMember(member: Member): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    const sure = await confirm(this, {
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
      dataChanged('settings', 'notes', 'wishlists', 'stats');
    } catch (error) {
      actionFailed(error, () => void this.removeMember(member));
    }
  }

  private rename(member: Member): void {
    this.memberSheet(
      text('settings.members.renameTitle', { name: member.name }),
      text('settings.members.renameSave'),
      member.name,
      false,
      async (name) => {
        await call('updateMember', { params: { id: member.id }, body: { name } });
        dataChanged('settings');
        await session.refresh();
      },
    );
  }

  private add(): void {
    this.memberSheet(
      text('settings.members.addTitle'),
      text('settings.members.addSave'),
      '',
      session.current.peek()?.requireLogin === true,
      async (name, password) => {
        await call('createMember', { body: { name, password } });
        dataChanged('settings');
      },
    );
  }

  private openMenu(event: MouseEvent, member: Member): void {
    const trigger = event.currentTarget;
    const menu = this.querySelector<LightElements['lc-dropdown']>(`#member-menu-${member.id}`);
    if (trigger instanceof Element && menu !== null) {
      menu.toggle(trigger);
    }
  }

  private row(member: Member, owner: boolean) {
    return html`<div class="cl-srow">
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
                @click=${(event: MouseEvent) => this.openMenu(event, member)}
                ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon
              ></lc-button>
              <lc-dropdown
                id=${`member-menu-${member.id}`}
                aria-label=${text('settings.members.actions', { name: member.name })}
                .items=${[
                  { label: text('settings.members.rename'), icon: 'pencil', onClick: () => this.rename(member) },
                  { label: text('settings.members.reset'), icon: 'key-round', onClick: () => void this.reset(member) },
                  {
                    label: text('settings.members.remove'),
                    icon: 'trash-2',
                    danger: true,
                    onClick: () => void this.removeMember(member),
                  },
                ]}
              ></lc-dropdown>`
          : nothing
      }
    </div>`;
  }

  private reveal(shown: OneTime) {
    return html`<lc-alert
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
  }

  private view(list: readonly Member[]) {
    const owner = session.current.value?.person.role === 'owner';
    const shown = this.oneTime.value;
    return html`<section class="cl-sgroup" aria-labelledby="settings-members">
      <h2 id="settings-members">${text('settings.members')}</h2>
      <p>${text('settings.members.lead')}</p>
      ${shown === null ? nothing : this.reveal(shown)}
      <div class="cl-panel">${list.map((member) => this.row(member, owner))}</div>
      ${
        owner
          ? html`<div class="cl-actions">
              <lc-button variant="quiet" @click=${() => this.add()}
                ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('settings.members.add')}</lc-button
              >
            </div>`
          : nothing
      }
    </section>`;
  }

  render() {
    return settingsFrame('members', () => {
      const list = this.members.value.value;
      return (
        settingsLoad(this.state, text('settings.members'), 'rows') ??
        (list === undefined ? nothing : this.view(list.members))
      );
    });
  }
}

View.register(tag, SettingsMembers);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsMembers;
  }
}
