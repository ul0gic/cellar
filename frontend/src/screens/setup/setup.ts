import { type Job, LIMITS } from '@cellar/contract';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { formValues, valueText } from '../../app/events.ts';
import { problemText } from '../../app/problems.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import { armFirstArrival } from '../../design-system/motion.ts';
import { text } from '../../text/index.ts';
import '../launch/not-found.ts';
import { introField } from '../login/parts/card-form.ts';
import { cardForm, stepDots } from '../login/parts/stage.ts';
import { switchField } from '../settings/parts/fields.ts';
import { followJob, jobProgress } from '../settings/parts/job.ts';

type Step = 'checking' | 'account' | 'options' | 'loading' | 'failed' | 'done';

export const tag = 'cl-screen-setup-setup';

const NOT_FOUND_PARAMS = { path: '/setup' };

const ACCOUNT_FIELDS: FormField[] = [
  introField(text('setup.account.title'), text('setup.account.lead')),
  { name: 'name', type: 'text', label: text('setup.name') },
  { name: 'password', type: 'password', label: text('setup.password'), help: text('setup.passwordHint') },
];

class SetupScreen extends View {
  readonly step = signal<Step>('checking');
  readonly values = signal<Record<string, unknown>>({ name: '', password: '' });
  readonly accountErrors = signal<Record<string, string>>({});
  readonly requireLogin = signal(true);
  readonly loadCatalog = signal(true);
  readonly busy = signal(false);
  readonly serverError = signal('');
  readonly job = signal<Job | null>(null);
  readonly failure = signal('');
  private checked = false;

  connected(): void {
    this.classList.add('cl-setup');
    if (!this.checked) {
      this.checked = true;
      void this.check();
    }
  }

  private async check(): Promise<void> {
    try {
      await call('getSession', {});
      this.step.value = 'done';
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code !== 'network_error') {
        this.step.value = error.code === 'setup_required' ? 'account' : 'done';
      }
    }
  }

  private enterHome(): void {
    if (!this.isConnected) {
      return;
    }
    armFirstArrival();
    navigate('/', { replace: true });
  }

  private continueToOptions(): void {
    const values = this.values.peek();
    const missing: Record<string, string> = {};
    if (valueText(values, 'name').trim().length === 0) {
      missing.name = text('setup.nameMissing');
    }
    if (valueText(values, 'password').length < LIMITS.password.min) {
      missing.password = text('setup.weak');
    }
    this.accountErrors.value = missing;
    if (Object.keys(missing).length === 0) {
      this.step.value = 'options';
    }
  }

  private async submit(): Promise<void> {
    if (this.busy.peek()) {
      return;
    }
    this.busy.value = true;
    this.serverError.value = '';
    const values = this.values.peek();
    try {
      const result = await call('runSetup', {
        body: {
          ownerName: valueText(values, 'name').trim(),
          password: valueText(values, 'password'),
          requireLogin: this.requireLogin.peek(),
          loadCatalog: this.loadCatalog.peek(),
        },
      });
      await session.refresh();
      if (result.catalogJob === null) {
        this.enterHome();
        return;
      }
      this.step.value = 'loading';
      const finished = await followJob(
        result.catalogJob,
        (next) => {
          this.job.value = next;
        },
        () => this.isConnected,
      );
      if (finished === null) {
        return;
      }
      if (finished.state === 'succeeded') {
        await session.refresh();
        this.enterHome();
        return;
      }
      this.failure.value = finished.error?.detail ?? text('setup.failedUnknown');
      this.step.value = 'failed';
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code === 'catalog_builtin_damaged') {
        await session.refresh();
        this.failure.value = error.detail;
        this.step.value = 'failed';
      } else if (error.code === 'validation_failed') {
        this.accountErrors.value = {
          name: error.fields.find((field) => field.path === 'ownerName')?.message ?? '',
          password: error.fields.find((field) => field.path === 'password')?.message ?? '',
        };
        this.step.value = 'account';
      } else {
        this.serverError.value = problemText(error);
      }
    } finally {
      this.busy.value = false;
    }
  }

  private account(): TemplateResult {
    return html`<lc-form
      class="cl-card-lcform cl-card-lcform-fields"
      layout="stacked"
      .fields=${ACCOUNT_FIELDS}
      .data=${this.values.value}
      .errors=${this.accountErrors.value}
      @field-change=${(event: Event) => {
        const values = formValues(event);
        if (values !== null) {
          this.values.value = values;
        }
      }}
      @form-submit=${() => this.continueToOptions()}
    >
      <lc-button class="cl-card-submit" variant="primary" type="submit" w-full>${text('setup.continue')}</lc-button>
      ${stepDots(1, 2)}
    </lc-form>`;
  }

  private options(): TemplateResult {
    return html`<lc-form class="cl-card-lcform cl-card-lcform-flow" layout="stacked" @form-submit=${() => void this.submit()}>
      <h1>${text('setup.options.title')}</h1>
      <p class="cl-card-lead">${text('setup.options.lead')}</p>
      ${
        this.serverError.value === ''
          ? nothing
          : html`<lc-alert class="cl-card-banner" variant="error" title=${text('setup.ownerFailed')}
              >${text('setup.ownerFailedBody', { reason: this.serverError.value })}</lc-alert
            >`
      }
      ${switchField(text('setup.requireLogin'), text('setup.requireLoginBody'), this.requireLogin.value, (checked) => {
        this.requireLogin.value = checked;
      })}
      ${switchField(text('setup.loadCatalog'), text('setup.loadCatalogBody'), this.loadCatalog.value, (checked) => {
        this.loadCatalog.value = checked;
      })}
      <lc-button class="cl-card-submit" variant="primary" type="submit" w-full ?disabled=${this.busy.value}
        >${text('setup.open')}</lc-button
      >
      ${stepDots(2, 2)}
    </lc-form>`;
  }

  private loading(): TemplateResult {
    const job = this.job.value;
    return html`<h1>${text('setup.loading.title')}</h1>
      <p class="cl-card-lead">${text('setup.loading.lead')}</p>
      ${job === null ? nothing : jobProgress(job, text('setup.loading.label'))}`;
  }

  private failed(): TemplateResult {
    return html`<h1>${text('setup.failed.title')}</h1>
      <lc-alert class="cl-card-banner" variant="error" title=${text('setup.failed.banner')}
        >${this.failure.value}</lc-alert
      >
      <lc-button variant="primary" w-full @click=${() => this.enterHome()}>${text('setup.failed.continue')}</lc-button>`;
  }

  render() {
    switch (this.step.value) {
      case 'checking':
        return nothing;
      case 'done':
        return html`<cl-screen-launch-not-found .params=${NOT_FOUND_PARAMS}></cl-screen-launch-not-found>`;
      case 'account':
        return cardForm(this.account());
      case 'options':
        return cardForm(this.options());
      case 'loading':
        return cardForm(this.loading());
      case 'failed':
        return cardForm(this.failed());
    }
  }
}

View.register(tag, SetupScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SetupScreen;
  }
}
