import { type CsvImportReport, type CsvKind, type DuplicateRule, LIMITS } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { text } from '../../text/index.ts';
import { detailField, download, droppedFile } from './files.ts';

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

export function csvPanel(kind: CsvKind, ctx: ScreenContext): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cl-import-csv';

  const duplicateLabel =
    kind === 'bottles' ? text('import-export.duplicateBottles') : text('import-export.duplicateIngredients');
  let step: Step = 1;
  let template: Template | null = null;
  let templateFailed = false;
  let file: File | null = null;
  let report: CsvImportReport | null = null;
  let duplicate: DuplicateRule = 'skip';
  let busy: 'checking' | 'saving' | null = null;
  let uploadError: string | null = null;
  let saveError: string | null = null;
  let done: Done | null = null;

  const send = (chosen: File, mode: 'dry_run' | 'commit'): Promise<CsvImportReport> => {
    const body = new FormData();
    body.append('file', new File([chosen], chosen.name, { type: 'text/csv' }));
    body.append('kind', kind);
    body.append('mode', mode);
    body.append('duplicate', duplicate);
    return call('importCsv', { body });
  };

  const uploadProblem = (error: ApiError): string => {
    if (error.code === 'unsupported_media_type') {
      return text('import-export.notCsv');
    }
    if (error.code === 'payload_too_large') {
      return text('import-export.tooLarge');
    }
    return error.detail;
  };

  const check = async (chosen: File): Promise<void> => {
    file = chosen;
    busy = 'checking';
    uploadError = null;
    saveError = null;
    draw();
    try {
      report = await send(chosen, 'dry_run');
      step = 3;
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      uploadError = uploadProblem(error);
      step = 2;
    } finally {
      busy = null;
      draw();
    }
  };

  const commit = async (): Promise<void> => {
    if (file === null) {
      return;
    }
    busy = 'saving';
    saveError = null;
    draw();
    try {
      const before = kind === 'bottles' ? await canMakeCount() : null;
      const saved = await send(file, 'commit');
      invalidate('shelf', 'ingredients', 'recipes', 'stats');
      const after = before === null ? null : await canMakeCount();
      done = { report: saved, more: before === null || after === null ? null : after - before };
      step = 4;
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const returned = error.problem?.report;
      if (error.code === 'import_has_errors' && returned !== undefined && 'kind' in returned) {
        report = returned;
      } else {
        saveError = error.detail;
      }
    } finally {
      busy = null;
      draw();
    }
  };

  const restart = (): void => {
    step = 2;
    file = null;
    report = null;
    done = null;
    uploadError = null;
    saveError = null;
    draw();
  };

  const templateStep = (): TemplateResult => {
    const name = `${kind}-template.csv`;
    return html`
      <h2 class="cl-import-heading">${text('import-export.templateTitle')}</h2>
      <p class="cl-import-text">
        ${kind === 'bottles' ? text('import-export.templateBottles') : text('import-export.templateIngredients')}
      </p>
      ${
        template === null
          ? templateFailed
            ? html`<lc-alert variant="error" title=${text('loadFailed.title', { screen: name })}>${text('loadFailed.body')}</lc-alert>`
            : nothing
          : html`<div class="cl-import-table">
              <lc-table
                label=${text('import-export.templateTable')}
                .columns=${template.header.map((column) => ({ name: column, label: column }))}
                .rows=${[Object.fromEntries(template.header.map((column, index) => [column, template?.sample[index] ?? '']))]}
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
          step = 2;
          draw();
        }}>${text('import-export.next')}</lc-button>
      </div>
    `;
  };

  const uploadStep = (): TemplateResult => html`
    <h2 class="cl-import-heading">${text('import-export.uploadTitle')}</h2>
    <lc-file-upload
      variant="dropzone"
      accept=".csv,text/csv"
      .maxSize=${LIMITS.csvBytes}
      .showPreview=${false}
      ?disabled=${busy !== null}
      @change=${(event: Event) => {
        const chosen = droppedFile(event);
        if (chosen !== null) {
          void check(chosen);
        }
      }}
    ></lc-file-upload>
    ${uploadError === null ? nothing : html`<p class="cl-import-error" role="alert">${uploadError}</p>`}
    ${
      busy === 'checking' && file !== null
        ? html`<lc-progress-bar indeterminate label=${text('import-export.checking', { file: file.name })}></lc-progress-bar>
          <p class="cl-import-text" role="status">${text('import-export.checking', { file: file.name })}</p>`
        : nothing
    }
    <div class="cl-import-actions">
      <lc-button variant="quiet" @click=${() => {
        step = 1;
        draw();
      }}>${text('import-export.backToTemplate')}</lc-button>
    </div>
  `;

  const tally = (checked: CsvImportReport): TemplateResult => {
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
  };

  const checkStep = (): TemplateResult => {
    if (report === null || file === null) {
      return html``;
    }
    const checked = report;
    const rowsToFix = new Set(checked.errors.map((error) => error.row)).size;
    const clean = checked.errors.length === 0;
    const toSave = checked.creates + checked.updates;
    return html`
      <h2 class="cl-import-heading">
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
            const rule = duplicateRule(detailField(event, 'value'));
            if (rule !== null && rule !== duplicate && file !== null) {
              duplicate = rule;
              void check(file);
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
        <lc-button variant="quiet" ?disabled=${busy !== null} @click=${restart}>${text('import-export.uploadAgain')}</lc-button>
        <lc-button variant="primary" ?disabled=${!clean || toSave === 0 || busy !== null} @click=${() => void commit()}>
          ${saveLabel(kind, toSave)}
        </lc-button>
      </div>
    `;
  };

  const doneStep = (): TemplateResult => {
    if (done === null) {
      return html``;
    }
    const { report: saved, more } = done;
    const added =
      kind === 'bottles'
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
        <lc-button variant="primary" @click=${() => ctx.navigate(kind === 'bottles' ? '/shelf' : '/ingredients')}>
          ${kind === 'bottles' ? text('import-export.seeShelf') : text('import-export.seeIngredients')}
        </lc-button>
        <lc-button variant="quiet" @click=${restart}>${text('import-export.importAnother')}</lc-button>
      </div>
    `;
  };

  const onStepChange = (event: Event): void => {
    const next = detailField(event, 'step');
    const previous = detailField(event, 'previousStep');
    if (previous === 4) {
      restart();
      return;
    }
    if (next === 1 || next === 2 || next === 3 || next === 4) {
      step = next;
      draw();
    }
  };

  function draw(): void {
    render(
      html`<lc-wizard
        total-steps="4"
        .currentStep=${step}
        .showNavigation=${false}
        @step-change=${onStepChange}
        @wizard-cancel=${(event: Event) => event.stopPropagation()}
      >
        <div slot="step-1" class="cl-import-step">${templateStep()}</div>
        <div slot="step-2" class="cl-import-step">${uploadStep()}</div>
        <div slot="step-3" class="cl-import-step">${checkStep()}</div>
        <div slot="step-4" class="cl-import-step">${doneStep()}</div>
      </lc-wizard>`,
      element,
    );
  }

  draw();
  readTemplate(kind)
    .then((loaded) => {
      template = loaded;
      draw();
    })
    .catch((error: unknown) => {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      templateFailed = true;
      draw();
    });
  return element;
}
