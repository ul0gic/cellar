import type { CatalogStatus, Job } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { switchField } from './parts/fields.ts';
import { settingsPage } from './parts/frame.ts';
import { followJob, jobProgress } from './parts/job.ts';
import { actionFailed, problemText } from './parts/problems.ts';
import { loadFailed, watch } from './parts/watch.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'catalog', (main) => {
    const status = resourceFor('getCatalogStatus', {}, { tags: ['settings'] });
    let job: Job | null = null;
    let checking = false;
    let checkError = '';

    const finish = async (finished: Job | null): Promise<void> => {
      job = null;
      if (finished === null) {
        return;
      }
      if (finished.state === 'failed') {
        toast({ title: finished.error?.detail ?? text('settings.catalog.failed'), variant: 'error' });
      } else if (finished.result !== null && 'added' in finished.result) {
        toast({
          title: text('settings.catalog.applied', { count: formatNumber(finished.result.added.recipes) }),
        });
      }
      invalidate('settings', 'recipes', 'ingredients', 'shelf');
      await ctx.person.refresh();
    };

    const run = async (start: () => Promise<Job>): Promise<void> => {
      try {
        await finish(
          await followJob(
            await start(),
            (next) => {
              job = next;
              redraw();
            },
            () => main.isConnected,
          ),
        );
      } catch (error) {
        job = null;
        actionFailed(error, () => void run(start));
      }
      redraw();
    };

    const check = async (): Promise<void> => {
      checking = true;
      checkError = '';
      redraw();
      try {
        await call('checkCatalog', {});
        invalidate('settings');
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'catalog_unreachable' || error.code === 'catalog_invalid')) {
          checkError = problemText(error);
        } else {
          actionFailed(error, () => void check());
        }
      } finally {
        checking = false;
      }
      redraw();
    };

    const schedule = async (monthly: boolean): Promise<void> => {
      try {
        await call('updateSettings', { body: { catalogSchedule: monthly ? 'monthly' : 'off' } });
        invalidate('settings');
      } catch (error) {
        actionFailed(error, () => void schedule(monthly));
      }
    };

    const loadedRow = (current: CatalogStatus): TemplateResult =>
      current.loaded === null
        ? html`<div class="cl-srow">
            <span class="cl-srow-text"><b>${text('settings.catalog.notLoaded')}</b></span>
            <lc-button variant="primary" ?disabled=${job !== null} @click=${() => void run(() => call('loadCatalog', {}))}
              >${text('home.loadCatalog')}</lc-button
            >
          </div>`
        : html`<div class="cl-srow">
            <span class="cl-srow-text"
              ><b>${text('settings.catalog.loaded')}</b
              ><span
                >${text('settings.catalog.loadedBody', {
                  version: current.loaded.version,
                  recipes: formatNumber(current.loaded.counts.recipes),
                  ingredients: formatNumber(current.loaded.counts.ingredients),
                })}</span
              ></span
            >
          </div>`;

    const updateRow = (current: CatalogStatus): TemplateResult | typeof nothing => {
      if (current.available !== null) {
        const version = current.available.version;
        return html`<div class="cl-srow">
          <span class="cl-srow-text"
            ><b>${text('settings.catalog.available', { version })}</b
            ><span
              >${text('settings.catalog.adds', {
                recipes: formatNumber(current.available.adds.recipes),
                ingredients: formatNumber(current.available.adds.ingredients),
              })}</span
            ></span
          >
          <lc-button
            variant="primary"
            ?disabled=${job !== null}
            @click=${() => void run(() => call('applyCatalogUpdate', { body: { version } }))}
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
    };

    const view = (current: CatalogStatus): TemplateResult => html`<section
      class="cl-sgroup"
      aria-labelledby="settings-catalog"
    >
      <h2 id="settings-catalog">${text('settings.catalog')}</h2>
      <p>${text('settings.catalog.lead')}</p>
      <div class="cl-panel">${loadedRow(current)} ${updateRow(current)}</div>
      ${job === null ? nothing : html`<div class="cl-job">${jobProgress(job, text('settings.catalog.working'))}</div>`}
      ${switchField(
        text('settings.catalog.monthly'),
        text('settings.catalog.monthlyBody'),
        current.schedule === 'monthly',
        (checked) => void schedule(checked),
      )}
      ${checkError === '' ? nothing : html`<p class="cl-field-error" role="alert">${checkError}</p>`}
      <div class="cl-actions">
        <lc-button variant="quiet" ?disabled=${checking || job !== null} @click=${() => void check()}>
          <lc-icon name="refresh-cw" aria-hidden="true"></lc-icon>${text('settings.catalog.check')}
        </lc-button>
      </div>
    </section>`;

    const redraw = watch(main, [status], ({ state, retry }) => {
      const current = status.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.catalog'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('lines', text('settings.catalog')), main);
      } else if (state === 'ready' && current !== undefined) {
        render(view(current), main);
      }
    });
  });
}
