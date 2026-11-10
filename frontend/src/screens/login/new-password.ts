import { LIMITS } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { loginHandoff } from '../../app/controllers/login-handoff.ts';
import { route } from '../../app/controllers/route.ts';
import { session } from '../../app/controllers/session.ts';
import { formValues, valueText } from '../../app/events.ts';
import { fieldError, problemText } from '../../app/problems.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { introField } from './parts/card-form.ts';
import { nextPath } from './parts/handoff.ts';
import { cardForm } from './parts/stage.ts';

type Form = LightElements['lc-form'];

export const tag = 'cl-screen-login-new-password';

const CURRENT_FIELD: FormField = {
  name: 'current',
  type: 'password',
  label: text('login.newPassword.current'),
};

const NEW_FIELDS: FormField[] = [
  {
    name: 'password',
    type: 'password',
    label: text('login.newPassword.new'),
    help: text('login.newPassword.hint'),
  },
  { name: 'again', type: 'password', label: text('login.newPassword.again') },
];

class NewPasswordScreen extends View {
  readonly held = loginHandoff.take();
  readonly values = signal<Record<string, unknown>>({ current: this.held ?? '', password: '', again: '' });
  readonly formError = signal('');
  readonly busy = signal(false);
  readonly fields: FormField[] = [
    introField(text('login.newPassword.title'), text('login.newPassword.lead')),
    ...(this.held === null ? [CURRENT_FIELD] : []),
    ...NEW_FIELDS,
  ];

  connected(): void {
    this.classList.add('cl-new-password');
  }

  private refused(error: ApiError): void {
    if (error.code === 'login_required' || error.code === 'profile_required') {
      if (this.isConnected) {
        navigate('/login', { replace: true });
      }
      return;
    }
    const refusedFields = error.code === 'validation_failed';
    const current = refusedFields ? fieldError(error, 'currentPassword') : '';
    const password = refusedFields ? fieldError(error, 'newPassword') : '';
    this.querySelector<Form>('lc-form')?.setErrors({ current, password });
    if (current === '' && password === '') {
      this.formError.value = problemText(error);
    }
  }

  private async submit(): Promise<void> {
    if (this.busy.peek()) {
      return;
    }
    const values = this.values.peek();
    const current = valueText(values, 'current');
    const password = valueText(values, 'password');
    const again = valueText(values, 'again');
    const missing: Record<string, string> = {};
    if (current.length === 0) {
      missing.current = text('login.newPassword.currentMissing');
    }
    if (password.length < LIMITS.password.min) {
      missing.password = text('login.newPassword.short');
    } else if (again !== password) {
      missing.again = text('login.newPassword.mismatch');
    }
    this.querySelector<Form>('lc-form')?.setErrors(missing);
    this.formError.value = '';
    if (Object.keys(missing).length > 0) {
      return;
    }
    this.busy.value = true;
    try {
      await call('changeMyPassword', { body: { currentPassword: current, newPassword: password } });
      await session.refresh();
      if (!this.isConnected) {
        return;
      }
      armFirstArrival();
      navigate(nextPath(route.query.peek()), { replace: true });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      this.refused(error);
    } finally {
      this.busy.value = false;
    }
  }

  render() {
    return cardForm(html`<lc-form
      class="cl-card-lcform cl-card-lcform-fields"
      layout="stacked"
      .fields=${this.fields}
      .data=${this.values.value}
      @field-change=${(event: Event) => {
        const values = formValues(event);
        if (values !== null) {
          this.values.value = values;
        }
      }}
      @form-submit=${() => void this.submit()}
    >
      ${
        this.formError.value === ''
          ? nothing
          : html`<lc-alert class="cl-card-banner" variant="error">${this.formError.value}</lc-alert>`
      }
      <lc-button class="cl-card-submit" variant="primary" type="submit" w-full ?disabled=${this.busy.value}
        >${text('login.newPassword.submit')}</lc-button
      >
    </lc-form>`);
  }
}

View.register(tag, NewPasswordScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: NewPasswordScreen;
  }
}
