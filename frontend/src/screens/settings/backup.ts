import { buildPath, type Job, RESTORE_CONFIRMATION, type RestoreUpload } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventFile } from '../../app/events.ts';
import { actionFailed, problemText } from '../../app/problems.ts';
import { href, navigate } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import { confirmTyped } from '../../design-system/dialogs.ts';
import { formatCount, formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { settingsFrame } from './parts/frame.ts';
import { followJob } from './parts/job.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/file-upload.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/progress-bar.ts';

export const tag = 'cl-screen-settings-backup';

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
    members: formatCount(counts.members, text('settings.count.memberOne'), text('settings.count.memberMany')),
    recipes: formatCount(counts.recipes, text('settings.count.recipeOne'), text('settings.count.recipeMany')),
    bottles: formatCount(counts.bottles, text('settings.count.bottleOne'), text('settings.count.bottleMany')),
    notes: formatCount(counts.notes, text('settings.count.noteOne'), text('settings.count.noteMany')),
  });
}

class SettingsBackup extends View {
  readonly phase = signal<Phase>({ kind: 'idle' });

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
  }

  private async restore(file: string, upload: RestoreUpload): Promise<void> {
    this.phase.value = { kind: 'restoring', file, job: null };
    const started = await call('startRestore', {
      body: { uploadId: upload.uploadId, confirmation: RESTORE_CONFIRMATION },
    });
    const finished = await followJob(
      started,
      (job) => {
        if (this.isConnected) {
          this.phase.value = { kind: 'restoring', file, job };
        }
      },
      () => this.isConnected,
    );
    if (finished === null) {
      return;
    }
    if (finished.state === 'failed') {
      if (!this.isConnected) {
        return;
      }
      this.phase.value = { kind: 'refused', reason: finished.error?.detail ?? text('settings.backup.failed') };
      return;
    }
    await session.refresh();
    navigate(`/who?restored=${encodeURIComponent(upload.manifest.createdAt)}`, { replace: true });
  }

  private async choose(file: File): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    this.phase.value = { kind: 'uploading', file: file.name };
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const upload = await call('uploadRestore', { body: form });
      if (!this.isConnected) {
        return;
      }
      this.phase.value = { kind: 'idle' };
      const sure = await confirmTyped(this, {
        title: text('settings.backup.confirmTitle'),
        message: summary(file.name, upload),
        phrase: RESTORE_CONFIRMATION,
        confirmLabel: text('settings.backup.confirm'),
      });
      if (!sure) {
        return;
      }
      await this.restore(file.name, upload);
    } catch (error) {
      if (error instanceof ApiError && REFUSALS.has(error.code)) {
        if (this.isConnected) {
          this.phase.value = { kind: 'refused', reason: problemText(error) };
        }
        return;
      }
      if (this.isConnected) {
        this.phase.value = { kind: 'idle' };
      }
      actionFailed(error, () => void this.choose(file));
    }
  }

  private drop(): TemplateResult {
    return html`<div class="cl-field">
      <span class="cl-field-label" id="backup-drop-label">${text('settings.backup.drop')}</span>
      <lc-file-upload
        variant="dropzone"
        accept=".zip"
        aria-labelledby="backup-drop-label"
        .showPreview=${false}
        @change=${(event: Event) => {
          const file = eventFile(event);
          if (file !== null) {
            void this.choose(file);
          }
        }}
      ></lc-file-upload>
    </div>`;
  }

  private restoreBody(phase: Phase): TemplateResult {
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
          ${this.drop()}`;
      case 'idle':
        return this.drop();
    }
  }

  private view(): TemplateResult {
    const phase = this.phase.value;
    const busy = phase.kind === 'uploading' || phase.kind === 'restoring';
    return html`<section class="cl-sgroup" aria-labelledby="settings-backup">
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
        ${this.restoreBody(phase)}
      </section>`;
  }

  render() {
    return settingsFrame('backup', () => this.view());
  }
}

View.register(tag, SettingsBackup);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsBackup;
  }
}
