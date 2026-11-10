import { type CsvImportReport, type CsvKind, type DuplicateRule, LIMITS } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { droppedFile, eventField } from '../../app/events.ts';
import { dataChanged } from '../../app/resources.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/cl-figure.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/file-upload.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/progress-bar.ts';
import '../../design-system/lc/segmented.ts';
import '../../design-system/lc/table.ts';
import '../../design-system/lc/wizard.ts';
import { text } from '../../text/index.ts';
import { download } from './files.ts';

type Step = 1 | 2 | 3 | 4;

interface Template {
  readonly header: readonly string[];
  readonly sample: readonly string[];
  readonly blob: Blob;
}

interface Done {
  readonly report: CsvImportReport;
  readonly more: number | null;
}

const DUPLICATE_RULES: readonly DuplicateRule[] = ['skip', 'update', 'create'];

function duplicateRule(value: unknown): DuplicateRule | null {
  return DUPLICATE_RULES.find((rule) => rule === value) ?? null;
}

function cells(line: string | undefined): string[] {
  return line === undefined || line.length === 0 ? [] : line.split(',');
}

async function readTemplate(kind: CsvKind): Promise<Template> {
  const blob = await call('getCsvTemplate', { params: { kind } });
  const lines = (await blob.text()).replace(/^﻿/, '').split(/\r?\n/);
  return { header: cells(lines[0]), sample: cells(lines[1]), blob };
}

async function canMakeCount(): Promise<number> {
  const page = await call('listRecipes', { query: { status: 'can_make', pageSize: 1 } });
  return page.facets.canMake;
}

function saveLabel(kind: CsvKind, count: number): string {
  if (count === 0) {
    return text('import-export.nothingToSave');
  }
  if (kind === 'bottles') {
    return count === 1 ? text('import-export.saveBottle') : text('import-export.saveBottles', { count });
  }
  return count === 1 ? text('import-export.saveIngredient') : text('import-export.saveIngredients', { count });
}

function tally(checked: CsvImportReport): TemplateResult {
  const errors = new Set(checked.errors.map((error) => error.row)).size;
  const cell = (count: number, label: string, bad = false): TemplateResult =>
    html`<div class=${bad && count > 0 ? 'cl-import-tally-cell is-bad' : 'cl-import-tally-cell'}>
      <b>${count}</b><span>${label}</span>
    </div>`;
  return html`<div class="cl-import-tally" role="group" aria-label=${text('import-export.tally')}>
    ${cell(checked.creates, text('import-export.tally.new'))}
    ${cell(checked.updates, text('import-export.tally.update'))}
    ${cell(checked.skips, text('import-export.tally.skip'))}
    ${cell(errors, text('import-export.tally.errors'), true)}
  </div>`;
}

function uploadProblem(error: ApiError): string {
  if (error.code === 'unsupported_media_type') {
    return text('import-export.notCsv');
  }
  if (error.code === 'payload_too_large') {
    return text('import-export.tooLarge');
  }
  return error.detail;
}

const bottlesTag = 'cl-import-export-csv-bottles';
const ingredientsTag = 'cl-import-export-csv-ingredients';

abstract class CsvPanel extends View {
  abstract readonly kind: CsvKind;
  readonly step = signal<Step>(1);
  readonly template = signal<Template | null>(null);
  readonly templateFailed = signal(false);
  readonly file = signal<File | null>(null);
  readonly report = signal<CsvImportReport | null>(null);
  readonly duplicate = signal<DuplicateRule>('skip');
  readonly busy = signal<'checking' | 'saving' | null>(null);
  readonly uploadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly done = signal<Done | null>(null);

  connected(): void {
    this.classList.add('cl-import-csv');
    let drawn = this.step.peek();
    let frame: number | null = null;
    const follow = effect(() => {
      const step = this.step.value;
      if (step === drawn) {
        return;
      }
      drawn = step;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = null;
          const shown = this.querySelector<HTMLElement>(`[slot="step-${this.step.peek()}"]`);
          (
            shown?.querySelector<HTMLElement>('.cl-import-heading') ?? shown?.querySelector<HTMLElement>('button')
          )?.focus();
        });
      });
    });
    this.$own(() => {
      follow.dispose();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    });
  }

  firstUpdated(): void {
    readTemplate(this.kind)
      .then((loaded) => {
        this.template.value = loaded;
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        this.templateFailed.value = true;
      });
  }

  send(chosen: File, mode: 'dry_run' | 'commit'): Promise<CsvImportReport> {
    const body = new FormData();
    body.append('file', new File([chosen], chosen.name, { type: 'text/csv' }));
    body.append('kind', this.kind);
    body.append('mode', mode);
    body.append('duplicate', this.duplicate.peek());
    return call('importCsv', { body });
  }

  async check(chosen: File): Promise<void> {
    this.file.value = chosen;
    this.busy.value = 'checking';
    this.uploadError.value = null;
    this.saveError.value = null;
    try {
      this.report.value = await this.send(chosen, 'dry_run');
      this.step.value = 3;
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      this.uploadError.value = uploadProblem(error);
      this.step.value = 2;
    } finally {
      this.busy.value = null;
    }
  }

  async commit(): Promise<void> {
    const chosen = this.file.peek();
    if (chosen === null) {
      return;
    }
    this.busy.value = 'saving';
    this.saveError.value = null;
    try {
      const before = this.kind === 'bottles' ? await canMakeCount() : null;
      const saved = await this.send(chosen, 'commit');
      dataChanged('shelf', 'ingredients', 'recipes', 'stats');
      const after = before === null ? null : await canMakeCount();
      this.done.value = { report: saved, more: before === null || after === null ? null : after - before };
      this.step.value = 4;
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const returned = error.problem?.report;
      if (error.code === 'import_has_errors' && returned !== undefined && 'kind' in returned) {
        this.report.value = returned;
      } else {
        this.saveError.value = error.detail;
      }
    } finally {
      this.busy.value = null;
    }
  }

  restart(): void {
    this.step.value = 2;
    this.file.value = null;
    this.report.value = null;
    this.done.value = null;
    this.uploadError.value = null;
    this.saveError.value = null;
  }

  templateStep(): TemplateResult {
    const name = `${this.kind}-template.csv`;
    const template = this.template.value;
    return html`
      <h2 class="cl-import-heading" tabindex="-1">${text('import-export.templateTitle')}</h2>
      <p class="cl-import-text">
        ${this.kind === 'bottles' ? text('import-export.templateBottles') : text('import-export.templateIngredients')}
      </p>
      ${
        template === null
          ? this.templateFailed.value
            ? html`<lc-alert variant="error" title=${text('loadFailed.title', { screen: name })}>${text('loadFailed.body')}</lc-alert>`
            : nothing
          : html`<div class="cl-import-table">
              <lc-table
                label=${text('import-export.templateTable')}
                .columns=${template.header.map((column) => ({ name: column, label: column }))}
                .rows=${[Object.fromEntries(template.header.map((column, index) => [column, template.sample[index] ?? '']))]}
              ></lc-table>
            </div>`
      }
      <div class="cl-import-actions">
        <lc-button
          variant="quiet"
          ?disabled=${template === null}
          @click=${() => template !== null && download(template.blob, name)}
        >
          <lc-icon name="download" aria-hidden="true"></lc-icon>${text('import-export.download', { file: name })}
        </lc-button>
        <lc-button variant="primary" @click=${() => {
          this.step.value = 2;
        }}>${text('import-export.next')}</lc-button>
      </div>
    `;
  }

  uploadStep(): TemplateResult {
    const file = this.file.value;
    const uploadError = this.uploadError.value;
    return html`
      <h2 class="cl-import-heading" tabindex="-1">${text('import-export.uploadTitle')}</h2>
      <lc-file-upload
        variant="dropzone"
        accept=".csv,text/csv"
        .maxSize=${LIMITS.csvBytes}
        .showPreview=${false}
        ?disabled=${this.busy.value !== null}
        @change=${(event: Event) => {
          const chosen = droppedFile(event);
          if (chosen !== null) {
            void this.check(chosen);
          }
        }}
      ></lc-file-upload>
      ${uploadError === null ? nothing : html`<p class="cl-import-error" role="alert">${uploadError}</p>`}
      ${
        this.busy.value === 'checking' && file !== null
          ? html`<lc-progress-bar indeterminate label=${text('import-export.checking', { file: file.name })}></lc-progress-bar>
            <p class="cl-import-text" role="status">${text('import-export.checking', { file: file.name })}</p>`
          : nothing
      }
      <div class="cl-import-actions">
        <lc-button variant="quiet" @click=${() => {
          this.step.value = 1;
        }}>${text('import-export.backToTemplate')}</lc-button>
      </div>
    `;
  }

  checkStep(): TemplateResult {
    const checked = this.report.value;
    const file = this.file.value;
    if (checked === null || file === null) {
      return html``;
    }
    const busy = this.busy.value;
    const saveError = this.saveError.value;
    const duplicate = this.duplicate.value;
    const duplicateLabel =
      this.kind === 'bottles' ? text('import-export.duplicateBottles') : text('import-export.duplicateIngredients');
    const rowsToFix = new Set(checked.errors.map((error) => error.row)).size;
    const clean = checked.errors.length === 0;
    const toSave = checked.creates + checked.updates;
    return html`
      <h2 class="cl-import-heading" tabindex="-1">
        ${
          clean
            ? text('import-export.ready', { file: file.name })
            : rowsToFix === 1
              ? text('import-export.toFixOne', { file: file.name })
              : text('import-export.toFix', { file: file.name, count: rowsToFix })
        }
      </h2>
      <p class="cl-import-text">${clean ? text('import-export.notSavedClean') : text('import-export.notSavedErrors')}</p>
      ${tally(checked)}
      <div class="cl-import-field">
        <span class="cl-import-label" aria-hidden="true">
          ${duplicateLabel}
        </span>
        <lc-segmented
          label=${duplicateLabel}
          .options=${[
            { value: 'skip', label: text('import-export.dup.skip') },
            { value: 'update', label: text('import-export.dup.update') },
            { value: 'create', label: text('import-export.dup.create') },
          ]}
          value=${duplicate}
          ?disabled=${busy !== null}
          @change=${(event: Event) => {
            const rule = duplicateRule(eventField(event, 'value'));
            if (rule !== null && rule !== duplicate) {
              this.duplicate.value = rule;
              void this.check(file);
            }
          }}
        ></lc-segmented>
      </div>
      ${
        checked.createdIngredients.length === 0
          ? nothing
          : html`<p class="cl-import-text">${text('import-export.newIngredients', { names: checked.createdIngredients.join(', ') })}</p>`
      }
      ${
        clean
          ? nothing
          : html`<div class="cl-import-table">
              <lc-table
                label=${text('import-export.errorsTable')}
                .columns=${[
                  { name: 'row', label: text('import-export.col.row'), align: 'right' },
                  { name: 'column', label: text('import-export.col.column') },
                  { name: 'reason', label: text('import-export.col.reason') },
                ]}
                .rows=${checked.errors.map((error) => ({ row: String(error.row), column: error.column ?? '', reason: error.reason }))}
              ></lc-table>
            </div>`
      }
      ${
        saveError === null
          ? nothing
          : html`<lc-alert variant="error" title=${text('import-export.saveFailedTitle')}>
              ${text('import-export.saveFailedBody', { reason: saveError })}
            </lc-alert>`
      }
      ${
        busy === null
          ? nothing
          : html`<lc-progress-bar
              indeterminate
              label=${text(busy === 'saving' ? 'import-export.saving' : 'import-export.checking', { file: file.name })}
            ></lc-progress-bar>`
      }
      <div class="cl-import-actions">
        <lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => this.restart()}>${text('import-export.uploadAgain')}</lc-button>
        <lc-button variant="primary" ?disabled=${!clean || toSave === 0 || busy !== null} @click=${() => void this.commit()}>
          ${saveLabel(this.kind, toSave)}
        </lc-button>
      </div>
    `;
  }

  doneStep(): TemplateResult {
    const finished = this.done.value;
    if (finished === null) {
      return html``;
    }
    const { report: saved, more } = finished;
    const added =
      this.kind === 'bottles'
        ? saved.creates === 1
          ? text('import-export.bottleAdded')
          : text('import-export.bottlesAdded')
        : saved.creates === 1
          ? text('import-export.ingredientAdded')
          : text('import-export.ingredientsAdded');
    const moreText =
      more === null || more <= 0
        ? ''
        : more === 1
          ? text('import-export.doneMoreOne')
          : text('import-export.doneMore', { count: more });
    return html`
      <cl-figure value=${saved.creates} label=${added} sublabel=${`${text('import-export.doneSummary', {
        updated: saved.updates,
        skipped: saved.skips,
      })} ${moreText}`.trim()}></cl-figure>
      <div class="cl-import-actions">
        <lc-button variant="primary" @click=${() => navigate(this.kind === 'bottles' ? '/shelf' : '/ingredients')}>
          ${this.kind === 'bottles' ? text('import-export.seeShelf') : text('import-export.seeIngredients')}
        </lc-button>
        <lc-button variant="quiet" @click=${() => this.restart()}>${text('import-export.importAnother')}</lc-button>
      </div>
    `;
  }

  onStepChange(event: Event): void {
    const next = eventField(event, 'step');
    const previous = eventField(event, 'previousStep');
    if (previous === 4) {
      this.restart();
      return;
    }
    if (next === 1 || next === 2 || next === 3 || next === 4) {
      this.step.value = next;
    }
  }

  render() {
    return html`<lc-wizard
      total-steps="4"
      .currentStep=${this.step.value}
      .showNavigation=${false}
      @step-change=${(event: Event) => this.onStepChange(event)}
      @wizard-cancel=${(event: Event) => event.stopPropagation()}
    >
      <div slot="step-1" class="cl-import-step">${this.templateStep()}</div>
      <div slot="step-2" class="cl-import-step">${this.uploadStep()}</div>
      <div slot="step-3" class="cl-import-step">${this.checkStep()}</div>
      <div slot="step-4" class="cl-import-step">${this.doneStep()}</div>
    </lc-wizard>`;
  }
}

class BottlesCsv extends CsvPanel {
  readonly kind = 'bottles';
}

class IngredientsCsv extends CsvPanel {
  readonly kind = 'ingredients';
}

View.register(bottlesTag, BottlesCsv);
View.register(ingredientsTag, IngredientsCsv);

declare global {
  interface HTMLElementTagNameMap {
    [bottlesTag]: BottlesCsv;
    [ingredientsTag]: IngredientsCsv;
  }
}
