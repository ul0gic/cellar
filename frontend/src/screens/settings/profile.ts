import { LIMITS, type Profile, type ProfilePatch, type ThemeChoice } from '@cellar/contract';
import { html, nothing, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { chooseTheme } from '../../app/theme.ts';
import type { ScreenContext } from '../../app/types.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { eventValue } from './parts/events.ts';
import { segmentedField, switchField } from './parts/fields.ts';
import { settingsPage } from './parts/frame.ts';
import { actionFailed, fieldError, problemText } from './parts/problems.ts';
import { openSheet } from './parts/sheet.ts';
import { loadFailed, watch } from './parts/watch.ts';

function isTheme(value: string): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function changePhoto(save: (patch: ProfilePatch) => Promise<void>): void {
  let error = '';
  const sheet = openSheet(text('settings.profile.photoTitle'), () => ({
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
            await save({ avatarImageId: image.id });
            sheet.close();
          } catch (failure) {
            if (!(failure instanceof ApiError)) {
              throw failure;
            }
            error = problemText(failure);
            sheet.redraw();
          }
        }}
      ></cl-image-field>
      ${error === '' ? nothing : html`<p class="cl-field-error" role="alert">${error}</p>`}`,
    footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>`,
  }));
}

function changePassword(): void {
  let current = '';
  let next = '';
  let again = '';
  let currentError = '';
  let nextError = '';
  let againError = '';
  let busy = false;
  const submit = async (): Promise<void> => {
    currentError = current.length === 0 ? text('settings.profile.currentMissing') : '';
    nextError = next.length < LIMITS.password.min ? text('setup.weak') : '';
    againError = nextError === '' && again !== next ? text('login.newPassword.mismatch') : '';
    if (currentError !== '' || nextError !== '' || againError !== '') {
      sheet.redraw();
      return;
    }
    busy = true;
    sheet.redraw();
    try {
      await call('changeMyPassword', { body: { currentPassword: current, newPassword: next } });
      sheet.close();
      toast({ title: text('settings.profile.passwordChanged') });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        currentError = fieldError(error, 'currentPassword');
        nextError = fieldError(error, 'newPassword');
      } else {
        actionFailed(error, () => void submit());
      }
    } finally {
      busy = false;
    }
    sheet.redraw();
  };
  const field = (label: string, value: string, error: string, autocomplete: string, set: (value: string) => void) =>
    html`<lc-input
      label=${label}
      type="password"
      autocomplete=${autocomplete}
      .value=${value}
      error-message=${error}
      @input=${(event: Event) => set(eventValue(event))}
    ></lc-input>`;
  const sheet = openSheet(text('settings.profile.changePassword'), () => ({
    body: html`<form
      id="cl-password-form"
      class="cl-sheet-form"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!busy) {
          void submit();
        }
      }}
    >
      ${field(text('settings.profile.current'), current, currentError, 'current-password', (value) => {
        current = value;
      })}
      ${field(text('login.newPassword.new'), next, nextError, 'new-password', (value) => {
        next = value;
      })}
      ${field(text('login.newPassword.again'), again, againError, 'new-password', (value) => {
        again = value;
      })}
    </form>`,
    footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button variant="primary" ?disabled=${busy} @click=${() => void submit()}
        >${text('settings.profile.changePassword')}</lc-button
      >`,
  }));
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'profile', (main) => {
    const me = resourceFor('getMe', {}, { tags: ['settings'] });
    const members = resourceFor('listMembers', {}, { tags: ['settings'] });
    let name: string | null = null;
    let nameError = '';

    const save = async (patch: ProfilePatch): Promise<void> => {
      try {
        await call('updateMe', { body: patch });
        if (patch.showPrices !== undefined) {
          invalidate('settings', 'shelf', 'stats');
        } else {
          invalidate('settings');
        }
        await ctx.person.refresh();
      } catch (error) {
        if (error instanceof ApiError && patch.name !== undefined && error.code === 'duplicate_name') {
          nameError = problemText(error);
          redraw();
          return;
        }
        actionFailed(error, () => void save(patch));
      }
    };

    const saveName = (profile: Profile): void => {
      const trimmed = (name ?? profile.name).trim();
      nameError = trimmed.length === 0 ? text('setup.nameMissing') : '';
      if (nameError === '' && trimmed !== profile.name) {
        void save({ name: trimmed });
      }
      redraw();
    };

    const view = (profile: Profile) => html`<section class="cl-sgroup" aria-labelledby="settings-profile">
      <h2 id="settings-profile">${text('settings.profile')}</h2>
      <div class="cl-profile-photo">
        <lc-avatar
          size="xl"
          seed=${String((members.peek()?.members.findIndex((member) => member.id === profile.id) ?? 0) + 1)}
          name=${profile.name} src=${profile.avatar?.url ?? nothing}></lc-avatar>
        <lc-button variant="quiet" @click=${() => changePhoto(save)}>
          <lc-icon name="image" aria-hidden="true"></lc-icon>${text('settings.profile.changePhoto')}
        </lc-button>
      </div>
      <div class="cl-form-grid">
        <lc-input
          label=${text('settings.profile.name')}
          autocomplete="nickname"
          .value=${name ?? profile.name}
          error-message=${nameError}
          @input=${(event: Event) => {
            name = eventValue(event);
          }}
          @change=${() => saveName(profile)}
        ></lc-input>
        ${segmentedField(
          text('settings.profile.units'),
          [
            { value: 'oz', label: text('settings.profile.oz') },
            { value: 'ml', label: text('settings.profile.ml') },
          ],
          profile.unit,
          (unit) => void save({ unit: unit === 'ml' ? 'ml' : 'oz' }),
        )}
        ${segmentedField(
          text('settings.profile.appearance'),
          [
            { value: 'light', label: text('settings.profile.light') },
            { value: 'dark', label: text('settings.profile.dark') },
            { value: 'system', label: text('settings.profile.system') },
          ],
          profile.theme,
          (theme) => {
            if (isTheme(theme)) {
              chooseTheme(theme);
              void save({ theme });
            }
          },
        )}
        ${segmentedField(
          text('settings.profile.visibility'),
          [
            { value: 'household', label: text('settings.profile.household') },
            { value: 'private', label: text('settings.profile.private') },
          ],
          profile.defaultVisibility,
          (visibility) => void save({ defaultVisibility: visibility === 'private' ? 'private' : 'household' }),
        )}
      </div>
      ${switchField(
        text('settings.profile.prices'),
        text('settings.profile.pricesBody'),
        profile.showPrices,
        (showPrices) => {
          void save({ showPrices });
        },
      )}
      <div class="cl-srow">
        <span class="cl-srow-text"><b>${text('settings.profile.password')}</b></span>
        <lc-button variant="quiet" @click=${changePassword}>${text('settings.profile.changePassword')}</lc-button>
      </div>
    </section>`;

    const redraw = watch(main, [me, members], ({ state, retry }) => {
      const profile = me.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.profile'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('lines', text('settings.profile')), main);
      } else if (state === 'ready' && profile !== undefined) {
        render(view(profile), main);
      }
    });
  });
}
