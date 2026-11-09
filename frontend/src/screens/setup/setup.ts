import { type Job, LIMITS } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import type { ScreenContext } from '../../app/types.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import { screen as notFound } from '../launch/not-found.ts';
import { cardForm, stepDots } from '../login/parts/stage.ts';
import { eventValue } from '../settings/parts/events.ts';
import { switchField } from '../settings/parts/fields.ts';
import { followJob, jobProgress } from '../settings/parts/job.ts';
import { problemText } from '../settings/parts/problems.ts';

type Step = 'checking' | 'account' | 'options' | 'loading' | 'failed' | 'done';

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-setup';
  let step: Step = 'checking';
  let name = '';
  let password = '';
  let passwordError = '';
  let nameError = '';
  let requireLogin = true;
  let loadCatalog = true;
  let busy = false;
  let serverError = '';
  let job: Job | null = null;
  let failure = '';

  const enterHome = (): void => {
    armFirstArrival();
    ctx.navigate('/', { replace: true });
  };

  const account = (): TemplateResult => html`<form
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        nameError = name.trim().length === 0 ? text('setup.nameMissing') : '';
        passwordError = password.length < LIMITS.password.min ? text('setup.weak') : '';
        if (nameError === '' && passwordError === '') {
          step = 'options';
        }
        draw();
      }}
    >
      <h1>${text('setup.account.title')}</h1>
      <p class="cl-card-lead">${text('setup.account.lead')}</p>
      <div class="cl-form-grid">
        <lc-input
          label=${text('setup.name')}
          name="name"
          autocomplete="username"
          .value=${name}
          error-message=${nameError}
          @input=${(event: Event) => {
            name = eventValue(event);
          }}
        ></lc-input>
        <div class="cl-field">
          <lc-input
            label=${text('setup.password')}
            name="password"
            type="password"
            autocomplete="new-password"
            .value=${password}
            error-message=${passwordError}
            hint=${text('setup.passwordHint')}
            @input=${(event: Event) => {
              password = eventValue(event);
            }}
          ></lc-input>
        </div>
      </div>
      <lc-button class="cl-card-submit" variant="primary" type="submit" w-full>${text('setup.continue')}</lc-button>
      ${stepDots(1, 2)}
    </form>`;

  const submit = async (): Promise<void> => {
    busy = true;
    serverError = '';
    draw();
    try {
      const result = await call('runSetup', { body: { ownerName: name.trim(), password, requireLogin, loadCatalog } });
      await ctx.person.refresh();
      if (result.catalogJob === null) {
        enterHome();
        return;
      }
      step = 'loading';
      const finished = await followJob(
        result.catalogJob,
        (next) => {
          job = next;
          draw();
        },
        () => element.isConnected,
      );
      if (finished === null) {
        return;
      }
      if (finished.state === 'succeeded') {
        await ctx.person.refresh();
        enterHome();
        return;
      }
      failure = finished.error?.detail ?? text('setup.failedUnknown');
      step = 'failed';
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code === 'catalog_builtin_damaged') {
        await ctx.person.refresh();
        failure = error.detail;
        step = 'failed';
      } else if (error.code === 'validation_failed') {
        nameError = error.fields.find((field) => field.path === 'ownerName')?.message ?? '';
        passwordError = error.fields.find((field) => field.path === 'password')?.message ?? '';
        step = 'account';
      } else {
        serverError = problemText(error);
      }
    } finally {
      busy = false;
    }
    draw();
  };

  const options = (): TemplateResult => html`<form
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!busy) {
          void submit();
        }
      }}
    >
      <h1>${text('setup.options.title')}</h1>
      <p class="cl-card-lead">${text('setup.options.lead')}</p>
      ${
        serverError === ''
          ? nothing
          : html`<lc-alert class="cl-card-banner" variant="error" title=${text('setup.ownerFailed')}
              >${text('setup.ownerFailedBody', { reason: serverError })}</lc-alert
            >`
      }
      ${switchField(text('setup.requireLogin'), text('setup.requireLoginBody'), requireLogin, (checked) => {
        requireLogin = checked;
      })}
      ${switchField(text('setup.loadCatalog'), text('setup.loadCatalogBody'), loadCatalog, (checked) => {
        loadCatalog = checked;
      })}
      <lc-button class="cl-card-submit" variant="primary" type="submit" w-full ?disabled=${busy}
        >${text('setup.open')}</lc-button
      >
      ${stepDots(2, 2)}
    </form>`;

  const loading = (): TemplateResult => html`<h1>${text('setup.loading.title')}</h1>
    <p class="cl-card-lead">${text('setup.loading.lead')}</p>
    ${job === null ? nothing : jobProgress(job, text('setup.loading.label'))}`;

  const failed = (): TemplateResult => html`<h1>${text('setup.failed.title')}</h1>
    <lc-alert class="cl-card-banner" variant="error" title=${text('setup.failed.banner')}
      >${failure}</lc-alert
    >
    <lc-button variant="primary" w-full @click=${enterHome}>${text('setup.failed.continue')}</lc-button>`;

  const draw = (): void => {
    switch (step) {
      case 'checking':
      case 'done':
        return;
      case 'account':
        render(cardForm(account()), element);
        return;
      case 'options':
        render(cardForm(options()), element);
        return;
      case 'loading':
        render(cardForm(loading()), element);
        return;
      case 'failed':
        render(cardForm(failed()), element);
        return;
    }
  };

  void (async () => {
    try {
      await call('getSession', {});
      step = 'done';
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code === 'network_error') {
        return;
      }
      step = error.code === 'setup_required' ? 'account' : 'done';
    }
    if (step === 'done') {
      element.replaceChildren(notFound({ ...ctx, params: { path: '/setup' } }));
      return;
    }
    draw();
  })();
  return element;
}
