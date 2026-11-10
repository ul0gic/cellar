import type { Session } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { loginHandoff } from '../../app/controllers/login-handoff.ts';
import { route } from '../../app/controllers/route.ts';
import { session } from '../../app/controllers/session.ts';
import { formValues, valueText } from '../../app/events.ts';
import { problemText } from '../../app/problems.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { introField } from './parts/card-form.ts';
import { nextPath } from './parts/handoff.ts';
import { arrivalNotice } from './parts/notices.ts';
import { stage } from './parts/stage.ts';

type Form = LightElements['lc-form'];

export const tag = 'cl-screen-login-login';

// D-1 §9.2: the too-many-tries countdown ticks each second.
const TICK_MS = 1000;
const SECONDS_PER_MINUTE = 60;

const FIELDS: FormField[] = [
  introField(text('login.title'), text('login.lead')),
  { name: 'name', type: 'text', label: text('login.name') },
  { name: 'password', type: 'password', label: text('login.password') },
];

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

class LoginScreen extends View {
  readonly values = signal<Record<string, unknown>>({ name: '', password: '' });
  readonly formError = signal('');
  readonly busy = signal(false);
  readonly blockedUntil = signal(0);
  readonly now = signal(0);

  connected(): void {
    this.classList.add('cl-login');
    let ticker: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
    };
    const countdown = effect(() => {
      const until = this.blockedUntil.value;
      stop();
      this.now.value = Date.now();
      if (until > this.now.peek()) {
        ticker = setInterval(() => {
          this.now.value = Date.now();
          if (this.now.peek() >= until) {
            stop();
          }
        }, TICK_MS);
      }
    });
    this.$own(() => {
      countdown.dispose();
      stop();
    });
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.blockedUntil.value - this.now.value) / TICK_MS));
  }

  private async signedIn(signedInAs: Session, password: string): Promise<void> {
    if (signedInAs.person.mustChangePassword) {
      if (!this.isConnected) {
        return;
      }
      loginHandoff.hold(password);
      const next = nextPath(route.query.peek());
      navigate(`/login/new-password${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`, { replace: true });
      return;
    }
    await session.refresh();
    if (!this.isConnected) {
      return;
    }
    armFirstArrival();
    navigate(nextPath(route.query.peek()), { replace: true });
  }

  private refused(error: ApiError): void {
    if (error.code === 'invalid_credentials') {
      this.querySelector<Form>('lc-form')?.setErrors({ password: text('error.invalid_credentials') });
    } else if (error.code === 'rate_limited' && error.problem?.retryAfterSeconds !== undefined) {
      this.blockedUntil.value = Date.now() + error.problem.retryAfterSeconds * TICK_MS;
    } else {
      this.formError.value = problemText(error);
    }
  }

  private async submit(): Promise<void> {
    if (this.busy.peek() || this.secondsLeft() > 0) {
      return;
    }
    const values = this.values.peek();
    const name = valueText(values, 'name').trim();
    const password = valueText(values, 'password');
    const missing: Record<string, string> = {};
    if (name.length === 0) {
      missing.name = text('login.nameMissing');
    }
    if (password.length === 0) {
      missing.password = text('login.passwordMissing');
    }
    this.querySelector<Form>('lc-form')?.setErrors(missing);
    this.formError.value = '';
    if (Object.keys(missing).length > 0) {
      return;
    }
    this.busy.value = true;
    try {
      await this.signedIn(await call('login', { body: { name, password } }), password);
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
    const secondsLeft = this.secondsLeft();
    const blocked = secondsLeft > 0;
    return stage(html`${arrivalNotice(route.query.value)}
      <lc-form
        class="cl-card-lcform cl-card-lcform-fields cl-card-lcform-self"
        layout="stacked"
        .fields=${FIELDS}
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
          blocked
            ? html`<lc-alert class="cl-card-banner" variant="error" icon="clock" title=${text('login.blocked')}
                >${text('login.blockedBody', { time: clock(secondsLeft) })}</lc-alert
              >`
            : nothing
        }
        ${
          this.formError.value === ''
            ? nothing
            : html`<lc-alert class="cl-card-banner" variant="error">${this.formError.value}</lc-alert>`
        }
        <lc-button class="cl-card-submit" variant="primary" type="submit" w-full ?disabled=${this.busy.value || blocked}
          >${text('login.submit')}</lc-button
        >
      </lc-form>`);
  }
}

View.register(tag, LoginScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: LoginScreen;
  }
}
