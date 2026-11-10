import type { CatalogStatus, Job } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, problemText } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { toast } from '../../design-system/toast.ts';
import { formatCount } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { switchField } from './parts/fields.ts';
import { settingsFrame, settingsLoad, settingsReadable } from './parts/frame.ts';
import { followJob, jobProgress } from './parts/job.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/icon.ts';

export const tag = 'cl-screen-settings-catalog';

function recipes(count: number): string {
  return formatCount(count, text('settings.count.recipeOne'), text('settings.count.recipeMany'));
}

function ingredients(count: number): string {
  return formatCount(count, text('settings.count.ingredientOne'), text('settings.count.ingredientMany'));
}

class SettingsCatalog extends View {
  readonly status = apiResource('getCatalogStatus', ['settings']);
  readonly state = loadState([this.status]);
  readonly job = signal<Job | null>(null);
  readonly checking = signal(false);
  readonly checkError = signal('');

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    if (settingsReadable('catalog')) {
      this.status.bind(this, {});
    }
  }

  private async finish(finished: Job | null): Promise<void> {
    if (this.isConnected) {
      this.job.value = null;
    }
    if (finished === null) {
      return;
    }
    if (finished.state === 'failed') {
      toast({ title: finished.error?.detail ?? text('settings.catalog.failed'), variant: 'error' });
    } else if (finished.result !== null && 'added' in finished.result) {
      toast({ title: text('settings.catalog.applied', { recipes: recipes(finished.result.added.recipes) }) });
    }
    dataChanged('settings', 'recipes', 'ingredients', 'shelf');
    await session.refresh();
  }

  private async run(start: () => Promise<Job>): Promise<void> {
    try {
      await this.finish(
        await followJob(
          await start(),
          (next) => {
            if (this.isConnected) {
              this.job.value = next;
            }
          },
          () => this.isConnected,
        ),
      );
    } catch (error) {
      if (this.isConnected) {
        this.job.value = null;
      }
      actionFailed(error, () => void this.run(start));
    }
  }

  private async check(): Promise<void> {
    this.checking.value = true;
    this.checkError.value = '';
    try {
      await call('checkCatalog', {});
      dataChanged('settings');
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'catalog_unreachable' || error.code === 'catalog_invalid')) {
        if (this.isConnected) {
          this.checkError.value = problemText(error);
        }
      } else {
        actionFailed(error, () => void this.check());
      }
    } finally {
      if (this.isConnected) {
        this.checking.value = false;
      }
    }
  }

  private async schedule(monthly: boolean): Promise<void> {
    try {
      await call('updateSettings', { body: { catalogSchedule: monthly ? 'monthly' : 'off' } });
      dataChanged('settings');
    } catch (error) {
      actionFailed(error, () => void this.schedule(monthly));
    }
  }

  private loadedRow(current: CatalogStatus): TemplateResult {
    return current.loaded === null
      ? html`<div class="cl-srow">
          <span class="cl-srow-text"><b>${text('settings.catalog.notLoaded')}</b></span>
          <lc-button
            variant="primary"
            ?disabled=${this.job.value !== null}
            @click=${() => void this.run(() => call('loadCatalog', {}))}
            >${text('home.loadCatalog')}</lc-button
          >
        </div>`
      : html`<div class="cl-srow">
          <span class="cl-srow-text"
            ><b>${text('settings.catalog.loaded')}</b
            ><span
              >${text('settings.catalog.loadedBody', {
                version: current.loaded.version,
                recipes: recipes(current.loaded.counts.recipes),
                ingredients: ingredients(current.loaded.counts.ingredients),
              })}</span
            ></span
          >
        </div>`;
  }

  private updateRow(current: CatalogStatus): TemplateResult | typeof nothing {
    if (current.available !== null) {
      const version = current.available.version;
      return html`<div class="cl-srow">
        <span class="cl-srow-text"
          ><b>${text('settings.catalog.available', { version })}</b
          ><span
            >${text('settings.catalog.adds', {
              recipes: recipes(current.available.adds.recipes),
              ingredients: ingredients(current.available.adds.ingredients),
            })}</span
          ></span
        >
        <lc-button
          variant="primary"
          ?disabled=${this.job.value !== null}
          @click=${() => void this.run(() => call('applyCatalogUpdate', { body: { version } }))}
          >${text('settings.catalog.apply')}</lc-button
        >
      </div>`;
    }
    if (current.lastCheck === null) {
      return nothing;
    }
    const line =
      current.lastCheck.result === 'failed'
        ? (current.lastCheck.message ?? text('settings.catalog.checkFailed'))
        : text('settings.catalog.latest');
    return html`<div class="cl-srow"><span class="cl-srow-text"><span>${line}</span></span></div>`;
  }

  private view(current: CatalogStatus): TemplateResult {
    const job = this.job.value;
    return html`<section class="cl-sgroup" aria-labelledby="settings-catalog">
      <h2 id="settings-catalog">${text('settings.catalog')}</h2>
      <p>${text('settings.catalog.lead')}</p>
      <div class="cl-panel">${this.loadedRow(current)} ${this.updateRow(current)}</div>
      ${job === null ? nothing : html`<div class="cl-job">${jobProgress(job, text('settings.catalog.working'))}</div>`}
      ${switchField(
        text('settings.catalog.monthly'),
        text('settings.catalog.monthlyBody'),
        current.schedule === 'monthly',
        (checked) => void this.schedule(checked),
      )}
      ${this.checkError.value === '' ? nothing : html`<p class="cl-field-error" role="alert">${this.checkError.value}</p>`}
      <div class="cl-actions">
        <lc-button variant="quiet" ?disabled=${this.checking.value || job !== null} @click=${() => void this.check()}>
          <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('settings.catalog.check')}
        </lc-button>
      </div>
    </section>`;
  }

  render() {
    return settingsFrame('catalog', () => {
      const current = this.status.value.value;
      return (
        settingsLoad(this.state, text('settings.catalog'), 'lines') ??
        (current === undefined ? nothing : this.view(current))
      );
    });
  }
}

View.register(tag, SettingsCatalog);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsCatalog;
  }
}
