import { buildPath, type Job, RESTORE_CONFIRMATION, type RestoreUpload } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { href } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirmTyped } from '../../design-system/dialogs.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { eventFile } from './parts/events.ts';
import { settingsPage } from './parts/frame.ts';
import { followJob } from './parts/job.ts';
import { actionFailed, problemText } from './parts/problems.ts';

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'uploading'; readonly file: string }
  | { readonly kind: 'restoring'; readonly file: string; readonly job: Job | null }
  | { readonly kind: 'refused'; readonly reason: string };

const REFUSALS = new Set([
  'backup_invalid',
  'backup_too_new',
  'archive_too_large',
  'payload_too_large',
  'unsupported_media_type',
]);

function summary(file: string, upload: RestoreUpload): string {
  const counts = upload.manifest.counts;
  return text('settings.backup.confirmBody', {
    file,
    date: formatDate(upload.manifest.createdAt),
    members: formatNumber(counts.members),
    recipes: formatNumber(counts.recipes),
    bottles: formatNumber(counts.bottles),
    notes: formatNumber(counts.notes),
  });
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'backup', (main) => {
    let phase: Phase = { kind: 'idle' };

    const restore = async (file: string, upload: RestoreUpload): Promise<void> => {
      phase = { kind: 'restoring', file, job: null };
      draw();
      const started = await call('startRestore', {
        body: { uploadId: upload.uploadId, confirmation: RESTORE_CONFIRMATION },
      });
      const finished = await followJob(
        started,
        (job) => {
          phase = { kind: 'restoring', file, job };
          draw();
        },
        () => main.isConnected,
      );
      if (finished === null) {
        return;
      }
      if (finished.state === 'failed') {
        phase = { kind: 'refused', reason: finished.error?.detail ?? text('settings.backup.failed') };
        draw();
        return;
      }
      await ctx.person.refresh();
      ctx.navigate(`/who?restored=${encodeURIComponent(upload.manifest.createdAt)}`, { replace: true });
    };

    const choose = async (file: File): Promise<void> => {
      phase = { kind: 'uploading', file: file.name };
      draw();
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        const upload = await call('uploadRestore', { body: form });
        const sure = await confirmTyped({
          title: text('settings.backup.confirmTitle'),
          message: summary(file.name, upload),
          phrase: RESTORE_CONFIRMATION,
          confirmLabel: text('settings.backup.confirm'),
        });
        if (!sure) {
          phase = { kind: 'idle' };
          draw();
          return;
        }
        await restore(file.name, upload);
      } catch (error) {
        if (error instanceof ApiError && REFUSALS.has(error.code)) {
          phase = { kind: 'refused', reason: problemText(error) };
        } else {
          phase = { kind: 'idle' };
          actionFailed(error, () => void choose(file));
        }
        draw();
      }
    };

    const restoreBody = (): TemplateResult => {
      switch (phase.kind) {
        case 'uploading':
          return html`<div class="cl-panel cl-panel-pad">
            <b>${text('settings.backup.uploading', { file: phase.file })}</b>
            <lc-progress-bar indeterminate label=${text('settings.backup.uploadingLabel')}></lc-progress-bar>
          </div>`;
        case 'restoring':
          return html`<div class="cl-panel cl-panel-pad">
            <b>${text('settings.backup.restoring', { file: phase.file })}</b>
            <lc-progress-bar indeterminate label=${text('settings.backup.restoringLabel')}></lc-progress-bar>
            <p class="cl-job-count" aria-live="polite">${phase.job?.step ?? ''}</p>
            <p class="cl-muted">${text('settings.backup.restoringBody')}</p>
          </div>`;
        case 'refused':
          return html`<lc-alert class="cl-settings-banner" variant="error" title=${text('settings.backup.refused')}
              >${phase.reason}</lc-alert
            >
            ${drop()}`;
        case 'idle':
          return drop();
      }
    };

    const drop = (): TemplateResult => html`<div class="cl-field">
      <span class="cl-field-label" id="backup-drop-label">${text('settings.backup.drop')}</span>
      <lc-file-upload
        variant="dropzone"
        accept=".zip"
        aria-labelledby="backup-drop-label"
        .showPreview=${false}
        @change=${(event: Event) => {
          const file = eventFile(event);
          if (file !== null) {
            void choose(file);
          }
        }}
      ></lc-file-upload>
    </div>`;

    const draw = (): void => {
      const busy = phase.kind === 'uploading' || phase.kind === 'restoring';
      render(
        html`<section class="cl-sgroup" aria-labelledby="settings-backup">
            <h2 id="settings-backup">${text('settings.backup.title')}</h2>
            <p>${text('settings.backup.lead')}</p>
            ${
              busy
                ? nothing
                : html`<a class="cl-download" href=${href(buildPath('downloadBackup'))} download
                    ><lc-icon name="download" aria-hidden="true"></lc-icon>${text('settings.backup.download')}</a
                  >`
            }
          </section>
          <section class="cl-sgroup" aria-labelledby="settings-restore">
            <h2 id="settings-restore">${text('settings.backup.restore')}</h2>
            <p>${text('settings.backup.restoreLead')}</p>
            ${restoreBody()}
          </section>`,
        main,
      );
    };

    draw();
  });
}
