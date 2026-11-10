import {
  type DuplicateRule,
  type IngredientTree,
  LIMITS,
  type RecipeImportReport,
  type RecipeImportRow,
} from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { droppedFile, eventField } from '../../app/events.ts';
import { dataChanged } from '../../app/resources.ts';
import { confirm } from '../../design-system/dialogs.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/file-upload.ts';
import '../../design-system/lc/progress-bar.ts';
import '../../design-system/lc/select.ts';
import { text } from '../../text/index.ts';

const DUPLICATE_RULES: readonly DuplicateRule[] = ['skip', 'update', 'create'];

const tag = 'cl-import-export-recipes';

const TOP_LEVEL = 'top';

interface ParentOption {
  readonly value: string;
  readonly label: string;
}

function parentOptions(tree: IngredientTree): ParentOption[] {
  const names = new Map(tree.nodes.map((node) => [node.id, node.name]));
  const parents = new Map(tree.nodes.map((node) => [node.id, node.parentId]));
  const path = (id: number): string => {
    const parent = parents.get(id) ?? null;
    const name = names.get(id) ?? '';
    return parent === null ? name : `${path(parent)} › ${name}`;
  };
  return tree.nodes
    .map((node) => ({ value: String(node.id), label: path(node.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function remotePhotoCount(file: File): Promise<number> {
  if (!file.name.toLowerCase().endsWith('.json')) {
    return 0;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    if (error instanceof SyntaxError) {
      return 0;
    }
    throw error;
  }
  if (typeof parsed !== 'object' || parsed === null || !('recipes' in parsed) || !Array.isArray(parsed.recipes)) {
    return 0;
  }
  let count = 0;
  for (const recipe of parsed.recipes) {
    const images: unknown = typeof recipe === 'object' && recipe !== null ? Reflect.get(recipe, 'images') : null;
    if (!Array.isArray(images)) {
      continue;
    }
    for (const image of images) {
      const source: unknown = typeof image === 'object' && image !== null ? Reflect.get(image, 'file') : null;
      if (typeof source === 'string' && /^https?:\/\//i.test(source)) {
        count += 1;
      }
    }
  }
  return count;
}

function rowResult(row: RecipeImportRow): string {
  const parts: string[] = [];
  switch (row.result) {
    case 'create':
      parts.push(text('import-export.added'));
      break;
    case 'update':
      parts.push(text('import-export.replaced'));
      break;
    case 'skip':
      parts.push(text('import-export.skipped'));
      break;
    case 'error':
      return text('import-export.notImported', { reason: row.errors.join(' ') });
  }
  if (row.createdIngredients.length > 0) {
    const names = row.createdIngredients.join(', ');
    parts.push(
      row.createdIngredients.length === 1
        ? text('import-export.createdIngredient', { names })
        : text('import-export.createdIngredients', { count: row.createdIngredients.length, names }),
    );
  }
  if (row.unmatchedGlass !== null) {
    parts.push(text('import-export.glassMissing', { name: row.unmatchedGlass }));
  }
  if (row.unmatchedMethod !== null) {
    parts.push(text('import-export.methodMissing', { name: row.unmatchedMethod }));
  }
  return parts.join(' ');
}

interface Failure {
  readonly title: string;
  readonly body: string;
}

const topLevel: ParentOption = { value: TOP_LEVEL, label: text('import-export.topLevel') };

class RecipesPanel extends View {
  readonly file = signal<File | null>(null);
  readonly parentId = signal(TOP_LEVEL);
  readonly options = signal<readonly ParentOption[]>([topLevel]);
  readonly duplicate = signal<DuplicateRule>('skip');
  readonly busy = signal(false);
  readonly fileError = signal<string | null>(null);
  readonly failure = signal<Failure | null>(null);
  readonly report = signal<RecipeImportReport | null>(null);

  connected(): void {
    this.classList.add('cl-import-recipes');
  }

  firstUpdated(): void {
    call('getIngredientTree', {})
      .then((tree) => {
        this.options.value = [topLevel, ...parentOptions(tree)];
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        this.failure.value = {
          title: text('loadFailed.title', { screen: text('import-export.parent') }),
          body: error.detail,
        };
      });
  }

  async importNow(): Promise<void> {
    const chosen = this.file.peek();
    if (chosen === null) {
      return;
    }
    const photos = await remotePhotoCount(chosen);
    if (!this.isConnected) {
      return;
    }
    const fetchPhotos =
      photos > 0 &&
      (await confirm(this, {
        title: text('import-export.remotePhotos'),
        message: text('import-export.recipesBody'),
        confirmLabel: text('import-export.fetchPhotos'),
        cancelLabel: text('import-export.skipPhotos'),
      }));
    if (!this.isConnected) {
      return;
    }
    this.busy.value = true;
    this.failure.value = null;
    this.fileError.value = null;
    this.report.value = null;
    const body = new FormData();
    const type = chosen.name.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/json';
    body.append('file', new File([chosen], chosen.name, { type }));
    body.append('mode', 'commit');
    body.append('duplicate', this.duplicate.peek());
    if (this.parentId.peek() !== TOP_LEVEL) {
      body.append('unmatchedParentId', this.parentId.peek());
    }
    body.append('fetchRemoteImages', String(fetchPhotos));
    try {
      this.report.value = await call('importRecipes', { body });
      dataChanged('recipes', 'ingredients', 'shelf', 'collections', 'stats');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const returned = error.problem?.report;
      if (error.code === 'import_has_errors' && returned !== undefined && 'format' in returned) {
        this.report.value = returned;
        this.failure.value = {
          title: text('import-export.recipeErrors', { file: chosen.name }),
          body: text('import-export.recipeErrorsBody'),
        };
      } else if (error.code === 'unsupported_media_type' || error.code === 'backup_invalid') {
        this.fileError.value = text('import-export.notRecipes');
      } else {
        this.failure.value = { title: text('import-export.saveFailedTitle'), body: error.detail };
      }
    } finally {
      this.busy.value = false;
    }
  }

  results(checked: RecipeImportReport): TemplateResult {
    return html`
      <section class="cl-import-results" aria-labelledby="cl-import-result">
        <h3 id="cl-import-result" class="cl-import-subheading">${text('import-export.result')}</h3>
        <p class="cl-import-text">${text('import-export.resultTotals', checked.totals)}</p>
        <ul class="cl-import-result-list">
          ${checked.recipes.map(
            (row) => html`<li class=${row.result === 'error' ? 'cl-import-result is-bad' : 'cl-import-result'}>
              <span class="cl-import-result-name">${row.name}</span>
              <span class="cl-import-result-text">${rowResult(row)}</span>
            </li>`,
          )}
        </ul>
      </section>
    `;
  }

  render() {
    const file = this.file.value;
    const busy = this.busy.value;
    const fileError = this.fileError.value;
    const failure = this.failure.value;
    const report = this.report.value;
    return html`
      <h2 class="cl-import-heading">${text('import-export.recipesTitle')}</h2>
      <p class="cl-import-text">${text('import-export.recipesBody')}</p>
      <lc-file-upload
        variant="dropzone"
        accept=".json,.zip,application/json,application/zip"
        .maxSize=${LIMITS.recipeJsonBytes}
        .showPreview=${false}
        ?disabled=${busy}
        @change=${(event: Event) => {
          this.file.value = droppedFile(event);
          this.fileError.value = null;
          this.report.value = null;
          this.failure.value = null;
        }}
      ></lc-file-upload>
      ${file === null ? nothing : html`<p class="cl-import-text">${text('import-export.chosen', { file: file.name })}</p>`}
      ${fileError === null ? nothing : html`<p class="cl-import-error" role="alert">${fileError}</p>`}
      <div class="cl-import-fields">
        <lc-select
          label=${text('import-export.parent')}
          searchable
          required
          .options=${this.options.value}
          value=${this.parentId.value}
          ?disabled=${busy}
          @change=${(event: Event) => {
            const value = eventField(event, 'value');
            this.parentId.value = typeof value === 'string' ? value : TOP_LEVEL;
          }}
        ></lc-select>
        <lc-select
          label=${text('import-export.duplicateRecipes')}
          .options=${[
            { value: 'skip', label: text('import-export.dup.skip') },
            { value: 'update', label: text('import-export.dup.replace') },
            { value: 'create', label: text('import-export.dup.createRecipe') },
          ]}
          value=${this.duplicate.value}
          ?disabled=${busy}
          @change=${(event: Event) => {
            const value = eventField(event, 'value');
            this.duplicate.value = DUPLICATE_RULES.find((rule) => rule === value) ?? this.duplicate.peek();
          }}
        ></lc-select>
      </div>
      ${failure === null ? nothing : html`<lc-alert variant="error" title=${failure.title}>${failure.body}</lc-alert>`}
      ${
        busy && file !== null
          ? html`<lc-progress-bar indeterminate label=${text('import-export.importingRecipes', { file: file.name })}></lc-progress-bar>
            <p class="cl-import-text" role="status">${text('import-export.importingRecipes', { file: file.name })}</p>`
          : nothing
      }
      <div class="cl-import-actions">
        <lc-button variant="primary" ?disabled=${busy || file === null} @click=${() => void this.importNow()}>
          ${text('import-export.importRecipes')}
        </lc-button>
      </div>
      ${report === null ? nothing : this.results(report)}
    `;
  }
}

View.register(tag, RecipesPanel);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: RecipesPanel;
  }
}
