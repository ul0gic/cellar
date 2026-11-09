import {
  type DuplicateRule,
  type IngredientTree,
  LIMITS,
  type RecipeImportReport,
  type RecipeImportRow,
} from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { droppedFile, eventField } from '../../app/events.ts';
import { invalidate } from '../../app/resources.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { text } from '../../text/index.ts';

const DUPLICATE_RULES: readonly DuplicateRule[] = ['skip', 'update', 'create'];

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

export function recipesPanel(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cl-import-recipes';

  let file: File | null = null;
  let parentId = TOP_LEVEL;
  const topLevel: ParentOption = { value: TOP_LEVEL, label: text('import-export.topLevel') };
  let options: ParentOption[] = [topLevel];
  let duplicate: DuplicateRule = 'skip';
  let busy = false;
  let fileError: string | null = null;
  let failure: { readonly title: string; readonly body: string } | null = null;
  let report: RecipeImportReport | null = null;

  const importNow = async (): Promise<void> => {
    if (file === null) {
      return;
    }
    const chosen = file;
    const photos = await remotePhotoCount(chosen);
    const fetchPhotos =
      photos > 0 &&
      (await confirm({
        title: text('import-export.remotePhotos'),
        message: text('import-export.recipesBody'),
        confirmLabel: text('import-export.fetchPhotos'),
        cancelLabel: text('import-export.skipPhotos'),
      }));
    busy = true;
    failure = null;
    fileError = null;
    report = null;
    draw();
    const body = new FormData();
    const type = chosen.name.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/json';
    body.append('file', new File([chosen], chosen.name, { type }));
    body.append('mode', 'commit');
    body.append('duplicate', duplicate);
    if (parentId !== TOP_LEVEL) {
      body.append('unmatchedParentId', parentId);
    }
    body.append('fetchRemoteImages', String(fetchPhotos));
    try {
      report = await call('importRecipes', { body });
      invalidate('recipes', 'ingredients', 'shelf', 'collections', 'stats');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const returned = error.problem?.report;
      if (error.code === 'import_has_errors' && returned !== undefined && 'format' in returned) {
        report = returned;
        failure = {
          title: text('import-export.recipeErrors', { file: chosen.name }),
          body: text('import-export.recipeErrorsBody'),
        };
      } else if (error.code === 'unsupported_media_type' || error.code === 'backup_invalid') {
        fileError = text('import-export.notRecipes');
      } else {
        failure = { title: text('import-export.saveFailedTitle'), body: error.detail };
      }
    } finally {
      busy = false;
      draw();
    }
  };

  const results = (checked: RecipeImportReport): TemplateResult => html`
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

  function draw(): void {
    render(
      html`
        <h2 class="cl-import-heading">${text('import-export.recipesTitle')}</h2>
        <p class="cl-import-text">${text('import-export.recipesBody')}</p>
        <lc-file-upload
          variant="dropzone"
          accept=".json,.zip,application/json,application/zip"
          .maxSize=${LIMITS.recipeJsonBytes}
          .showPreview=${false}
          ?disabled=${busy}
          @change=${(event: Event) => {
            file = droppedFile(event);
            fileError = null;
            report = null;
            failure = null;
            draw();
          }}
        ></lc-file-upload>
        ${file === null ? nothing : html`<p class="cl-import-text">${text('import-export.chosen', { file: file.name })}</p>`}
        ${fileError === null ? nothing : html`<p class="cl-import-error" role="alert">${fileError}</p>`}
        <div class="cl-import-fields">
          <lc-select
            label=${text('import-export.parent')}
            searchable
            required
            .options=${options}
            value=${parentId}
            ?disabled=${busy}
            @change=${(event: Event) => {
              const value = eventField(event, 'value');
              parentId = typeof value === 'string' ? value : TOP_LEVEL;
              draw();
            }}
          ></lc-select>
          <lc-select
            label=${text('import-export.duplicateRecipes')}
            .options=${[
              { value: 'skip', label: text('import-export.dup.skip') },
              { value: 'update', label: text('import-export.dup.replace') },
              { value: 'create', label: text('import-export.dup.createRecipe') },
            ]}
            value=${duplicate}
            ?disabled=${busy}
            @change=${(event: Event) => {
              const value = eventField(event, 'value');
              duplicate = DUPLICATE_RULES.find((rule) => rule === value) ?? duplicate;
            }}
          ></lc-select>
        </div>
        ${
          failure === null ? nothing : html`<lc-alert variant="error" title=${failure.title}>${failure.body}</lc-alert>`
        }
        ${
          busy && file !== null
            ? html`<lc-progress-bar indeterminate label=${text('import-export.importingRecipes', { file: file.name })}></lc-progress-bar>
              <p class="cl-import-text" role="status">${text('import-export.importingRecipes', { file: file.name })}</p>`
            : nothing
        }
        <div class="cl-import-actions">
          <lc-button variant="primary" ?disabled=${busy || file === null} @click=${() => void importNow()}>
            ${text('import-export.importRecipes')}
          </lc-button>
        </div>
        ${report === null ? nothing : results(report)}
      `,
      element,
    );
  }

  draw();
  call('getIngredientTree', {})
    .then((tree) => {
      options = [topLevel, ...parentOptions(tree)];
      draw();
    })
    .catch((error: unknown) => {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      failure = { title: text('loadFailed.title', { screen: text('import-export.parent') }), body: error.detail };
      draw();
    });
  return element;
}
