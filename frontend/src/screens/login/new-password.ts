import { LIMITS } from '@cellar/contract';
import { html, nothing, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import type { ScreenContext } from '../../app/types.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { eventValue } from '../settings/parts/events.ts';
import { fieldError, problemText } from '../settings/parts/problems.ts';
import { nextPath, takeOneTimePassword } from './parts/handoff.ts';
import { cardForm } from './parts/stage.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-new-password';
  const held = takeOneTimePassword();
  let current = held ?? '';
  let password = '';
  let again = '';
  let currentError = '';
  let passwordError = '';
  let againError = '';
  let formError = '';
  let busy = false;

  const field = (
    label: string,
    name: string,
    autocomplete: string,
    value: string,
    error: string,
    change: (value: string) => void,
    hint = '',
  ) => html`<lc-input
    label=${label}
    name=${name}
    type="password"
    autocomplete=${autocomplete}
    .value=${value}
    error-message=${error}
    hint=${hint}
    @input=${(event: Event) => change(eventValue(event))}
  ></lc-input>`;

  const refused = (error: ApiError): void => {
    if (error.code === 'login_required' || error.code === 'profile_required') {
      ctx.navigate('/login', { replace: true });
      return;
    }
    if (error.code === 'validation_failed') {
      currentError = fieldError(error, 'currentPassword');
      passwordError = fieldError(error, 'newPassword');
    }
    if (currentError === '' && passwordError === '') {
      formError = problemText(error);
    }
  };

  const submit = async (): Promise<void> => {
    currentError = current.length === 0 ? text('login.newPassword.currentMissing') : '';
    passwordError = password.length < LIMITS.password.min ? text('login.newPassword.short') : '';
    againError = passwordError === '' && again !== password ? text('login.newPassword.mismatch') : '';
    formError = '';
    if (currentError !== '' || passwordError !== '' || againError !== '') {
      draw();
      return;
    }
    busy = true;
    draw();
    try {
      await call('changeMyPassword', { body: { currentPassword: current, newPassword: password } });
      await ctx.person.refresh();
      armFirstArrival();
      ctx.navigate(nextPath(ctx.query), { replace: true });
      return;
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      refused(error);
    } finally {
      busy = false;
    }
    draw();
  };

  const draw = (): void => {
    render(
      cardForm(html`<form
        novalidate
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          if (!busy) {
            void submit();
          }
        }}
      >
        <h1>${text('login.newPassword.title')}</h1>
        <p class="cl-card-lead">${text('login.newPassword.lead')}</p>
        <div class="cl-form-grid">
          ${
            held === null
              ? field(
                  text('login.newPassword.current'),
                  'current',
                  'current-password',
                  current,
                  currentError,
                  (value) => {
                    current = value;
                  },
                )
              : nothing
          }
          ${field(
            text('login.newPassword.new'),
            'password',
            'new-password',
            password,
            passwordError,
            (value) => {
              password = value;
            },
            text('login.newPassword.hint'),
          )}
          ${field(text('login.newPassword.again'), 'again', 'new-password', again, againError, (value) => {
            again = value;
          })}
        </div>
        ${formError === '' ? nothing : html`<lc-alert class="cl-card-banner" variant="error">${formError}</lc-alert>`}
        <lc-button class="cl-card-submit" variant="primary" type="submit" w-full ?disabled=${busy}
          >${text('login.newPassword.submit')}</lc-button
        >
      </form>`),
      element,
    );
  };

  draw();
  return element;
}
