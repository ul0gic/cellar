import { LIMITS, type Profile, type ProfilePatch } from '@cellar/contract';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventText, formValues, valueText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, formErrors, problemText } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { segmentedField, switchField } from './parts/fields.ts';
import { settingsFrame, settingsLoad } from './parts/frame.ts';
import { openSheet, type Sheet } from './parts/sheet.ts';
import '../../design-system/cl-image-field.ts';
import '../../design-system/lc/avatar.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/input.ts';

export const tag = 'cl-screen-settings-profile';

const PASSWORD_NAMES = ['currentPassword', 'newPassword'];

const PASSWORD_FIELDS: FormField[] = [
  { name: 'currentPassword', type: 'password', label: text('settings.profile.current') },
  { name: 'newPassword', type: 'password', label: text('login.newPassword.new') },
  { name: 'again', type: 'password', label: text('login.newPassword.again') },
];

class SettingsProfile extends View {
  readonly me = apiResource('getMe', ['settings']);
  readonly members = apiResource('listMembers', ['settings']);
  readonly state = loadState([this.me, this.members]);
  readonly name = signal<string | null>(null);
  readonly nameError = signal('');

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    this.me.bind(this, {});
    this.members.bind(this, {});
  }

  private async save(patch: ProfilePatch): Promise<void> {
    try {
      await call('updateMe', { body: patch });
      if (patch.showPrices !== undefined) {
        dataChanged('settings', 'shelf', 'stats');
      } else {
        dataChanged('settings');
      }
      await session.refresh();
    } catch (error) {
      if (error instanceof ApiError && patch.name !== undefined && error.code === 'duplicate_name') {
        if (this.isConnected) {
          this.nameError.value = problemText(error);
        }
        return;
      }
      actionFailed(error, () => void this.save(patch));
    }
  }

  private saveName(profile: Profile): void {
    const trimmed = (this.name.value ?? profile.name).trim();
    this.nameError.value = trimmed.length === 0 ? text('setup.nameMissing') : '';
    if (this.nameError.value === '' && trimmed !== profile.name) {
      void this.save({ name: trimmed });
    }
  }

  private changePhoto(): void {
    const photoError = signal('');
    const sheet: Sheet = openSheet(this, text('settings.profile.photoTitle'), () => ({
      body: html`<cl-image-field
          purpose="avatar"
          .change=${async (upload: ImageUpload) => {
            const form = new FormData();
            form.append('file', upload.file, 'avatar.webp');
            form.append('purpose', upload.purpose);
            form.append('width', String(upload.width));
            form.append('height', String(upload.height));
            form.append('thumbhash', upload.thumbhash);
            try {
              const image = await call('uploadImage', { body: form });
              await this.save({ avatarImageId: image.id });
              sheet.close();
            } catch (failure) {
              if (!(failure instanceof ApiError)) {
                throw failure;
              }
              photoError.value = problemText(failure);
            }
          }}
        ></cl-image-field>
        ${photoError.value === '' ? nothing : html`<p class="cl-field-error" role="alert">${photoError.value}</p>`}`,
      footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>`,
    }));
  }

  private changePassword(): void {
    const fieldValues = signal<Record<string, unknown>>({});
    const fieldErrors = signal<Record<string, string>>({});
    const working = signal(false);
    const submit = async (): Promise<void> => {
      const current = valueText(fieldValues.peek(), 'currentPassword');
      const next = valueText(fieldValues.peek(), 'newPassword');
      const again = valueText(fieldValues.peek(), 'again');
      const missing: Record<string, string> = {};
      if (current.length === 0) {
        missing.currentPassword = text('settings.profile.currentMissing');
      }
      if (next.length < LIMITS.password.min) {
        missing.newPassword = text('setup.weak');
      } else if (again !== next) {
        missing.again = text('login.newPassword.mismatch');
      }
      fieldErrors.value = missing;
      if (Object.keys(missing).length > 0) {
        return;
      }
      working.value = true;
      try {
        await call('changeMyPassword', { body: { currentPassword: current, newPassword: next } });
        sheet.close();
        toast({ title: text('settings.profile.passwordChanged') });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          fieldErrors.value = formErrors(error, PASSWORD_NAMES).fields;
        } else {
          actionFailed(error, () => void submit());
        }
      } finally {
        working.value = false;
      }
    };
    const sheet: Sheet = openSheet(this, text('settings.profile.changePassword'), () => ({
      body: html`<lc-form
        class="cl-settings-form"
        layout="stacked"
        .fields=${PASSWORD_FIELDS}
        .data=${fieldValues.value}
        .errors=${fieldErrors.value}
        @field-change=${(event: Event) => {
          const values = formValues(event);
          if (values !== null) {
            fieldValues.value = values;
          }
        }}
        @form-submit=${() => {
          if (!working.peek()) {
            void submit();
          }
        }}
      ></lc-form>`,
      footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${working.value} @click=${() => void submit()}
          >${text('settings.profile.changePassword')}</lc-button
        >`,
    }));
  }

  private view(profile: Profile) {
    return html`<section class="cl-sgroup" aria-labelledby="settings-profile">
      <h2 id="settings-profile">${text('settings.profile')}</h2>
      <div class="cl-profile-photo">
        <lc-avatar shape="rounded" size="xl" name=${profile.name} src=${profile.avatar?.url ?? nothing}></lc-avatar>
        <lc-button variant="quiet" @click=${() => this.changePhoto()}>
          <lc-icon name="image" aria-hidden="true"></lc-icon>${text('settings.profile.changePhoto')}
        </lc-button>
      </div>
      <div class="cl-form-grid">
        <lc-input
          label=${text('settings.profile.name')}
          autocomplete="nickname"
          .value=${this.name.value ?? profile.name}
          error-message=${this.nameError.value}
          @input=${(event: Event) => {
            this.name.value = eventText(event);
          }}
          @change=${() => this.saveName(profile)}
        ></lc-input>
        ${segmentedField(
          text('settings.profile.units'),
          [
            { value: 'oz', label: text('settings.profile.oz') },
            { value: 'ml', label: text('settings.profile.ml') },
          ],
          profile.unit,
          (unit) => void this.save({ unit: unit === 'ml' ? 'ml' : 'oz' }),
        )}
        ${segmentedField(
          text('settings.profile.visibility'),
          [
            { value: 'household', label: text('settings.profile.household') },
            { value: 'private', label: text('settings.profile.private') },
          ],
          profile.defaultVisibility,
          (visibility) => void this.save({ defaultVisibility: visibility === 'private' ? 'private' : 'household' }),
        )}
      </div>
      ${switchField(
        text('settings.profile.prices'),
        text('settings.profile.pricesBody'),
        profile.showPrices,
        (showPrices) => {
          void this.save({ showPrices });
        },
      )}
      <div class="cl-srow">
        <span class="cl-srow-text"><b>${text('settings.profile.password')}</b></span>
        <lc-button variant="quiet" @click=${() => this.changePassword()}>${text('settings.profile.changePassword')}</lc-button>
      </div>
    </section>`;
  }

  render() {
    return settingsFrame('profile', () => {
      const profile = this.me.value.value;
      return (
        settingsLoad(this.state, text('settings.profile'), 'lines') ??
        (profile === undefined ? nothing : this.view(profile))
      );
    });
  }
}

View.register(tag, SettingsProfile);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsProfile;
  }
}
