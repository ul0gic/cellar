import type { Session } from '@cellar/contract';
import { html, nothing, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { problemText } from '../../app/problems.ts';
import type { ScreenContext } from '../../app/types.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { holdOneTimePassword, nextPath } from './parts/handoff.ts';
import { arrivalNotice } from './parts/notices.ts';
import { stage } from './parts/stage.ts';

// D-1 §9.2: the too-many-tries countdown ticks each second.
const TICK_MS = 1000;
const SECONDS_PER_MINUTE = 60;

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-login';
  let name = '';
  let password = '';
  let nameError = '';
  let passwordError = '';
  let formError = '';
  let busy = false;
  let blockedUntil = 0;
  let ticker: ReturnType<typeof setInterval> | null = null;

  const secondsLeft = (): number => Math.max(0, Math.ceil((blockedUntil - Date.now()) / TICK_MS));

  const block = (seconds: number): void => {
    blockedUntil = Date.now() + seconds * TICK_MS;
    if (ticker !== null) {
      clearInterval(ticker);
    }
    ticker = setInterval(() => {
      if (!element.isConnected || secondsLeft() === 0) {
        if (ticker !== null) {
          clearInterval(ticker);
        }
        ticker = null;
      }
      draw();
    }, TICK_MS);
  };

  const signedIn = async (session: Session): Promise<void> => {
    if (session.person.mustChangePassword) {
      holdOneTimePassword(password);
      const next = nextPath(ctx.query);
      ctx.navigate(`/login/new-password${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`, { replace: true });
      return;
    }
    await ctx.person.refresh();
    armFirstArrival();
    ctx.navigate(nextPath(ctx.query), { replace: true });
  };

  const refused = (error: ApiError): void => {
    if (error.code === 'invalid_credentials') {
      passwordError = text('error.invalid_credentials');
    } else if (error.code === 'rate_limited' && error.problem?.retryAfterSeconds !== undefined) {
      block(error.problem.retryAfterSeconds);
    } else {
      formError = problemText(error);
    }
  };

  const submit = async (): Promise<void> => {
    nameError = name.trim().length === 0 ? text('login.nameMissing') : '';
    passwordError = password.length === 0 ? text('login.passwordMissing') : '';
    formError = '';
    if (nameError !== '' || passwordError !== '') {
      draw();
      return;
    }
    busy = true;
    draw();
    try {
      await signedIn(await call('login', { body: { name: name.trim(), password } }));
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
    const blocked = secondsLeft() > 0;
    render(
      stage(html`${arrivalNotice(ctx.query)}
        <form
          class="cl-card-form"
          novalidate
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            if (!busy && !blocked) {
              void submit();
            }
          }}
        >
          <h1>${text('login.title')}</h1>
          <p class="cl-card-lead">${text('login.lead')}</p>
          <div class="cl-form-grid">
            <lc-input
              label=${text('login.name')}
              name="name"
              autocomplete="username"
              .value=${name}
              error-message=${nameError}
              @input=${(event: Event) => {
                name = eventText(event);
              }}
            ></lc-input>
            <lc-input
              label=${text('login.password')}
              name="password"
              type="password"
              autocomplete="current-password"
              .value=${password}
              error-message=${passwordError}
              @input=${(event: Event) => {
                password = eventText(event);
              }}
            ></lc-input>
          </div>
          ${
            blocked
              ? html`<lc-alert class="cl-card-banner" variant="error" icon="clock" title=${text('login.blocked')}
                  >${text('login.blockedBody', { time: clock(secondsLeft()) })}</lc-alert
                >`
              : nothing
          }
          ${formError === '' ? nothing : html`<lc-alert class="cl-card-banner" variant="error">${formError}</lc-alert>`}
          <lc-button class="cl-card-submit" variant="primary" type="submit" w-full ?disabled=${busy || blocked}
            >${text('login.submit')}</lc-button
          >
        </form>`),
      element,
    );
  };

  draw();
  return element;
}
