import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { actionFailed } from '../../app/problems.ts';
import { href } from '../../app/router.ts';
import { settingsPath } from '../../app/routes.ts';
import { toast } from '../../design-system/toast.ts';
import { type TextKey, text } from '../../text/index.ts';
import { download } from './files.ts';

type ExportKind = 'bottles' | 'ingredients' | 'recipes';

interface ExportRow {
  readonly kind: ExportKind;
  readonly file: string;
  readonly label: TextKey;
  readonly hint: TextKey;
}

const ROWS: readonly ExportRow[] = [
  {
    kind: 'bottles',
    file: 'bottles.csv',
    label: 'import-export.exportBottles',
    hint: 'import-export.exportBottlesHint',
  },
  {
    kind: 'ingredients',
    file: 'ingredients.csv',
    label: 'import-export.exportIngredients',
    hint: 'import-export.exportIngredientsHint',
  },
  {
    kind: 'recipes',
    file: 'recipes.zip',
    label: 'import-export.exportRecipes',
    hint: 'import-export.exportRecipesHint',
  },
];

function fetchExport(kind: ExportKind): Promise<Blob> {
  switch (kind) {
    case 'bottles':
      return call('exportBottles', {});
    case 'ingredients':
      return call('exportIngredients', { query: { provenance: 'household' } });
    case 'recipes':
      return call('exportRecipes', {});
  }
}

export function exportPanel(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cl-import-export';
  let busy: ExportKind | null = null;

  const save = async (row: ExportRow): Promise<void> => {
    busy = row.kind;
    draw();
    try {
      download(await fetchExport(row.kind), row.file);
      toast({ title: text('import-export.exported', { file: row.file }) });
    } catch (error) {
      actionFailed(error, () => void save(row));
    } finally {
      busy = null;
      draw();
    }
  };

  const line = (row: ExportRow): TemplateResult => html`<li class="cl-import-export-row">
    <span class="cl-import-export-text">
      <span class="cl-import-export-name">${text(row.label)}</span>
      <span class="cl-import-export-hint">${text(row.hint)}</span>
    </span>
    <lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => void save(row)}>
      <lc-icon name="download" aria-hidden="true"></lc-icon>${row.file}
    </lc-button>
  </li>`;

  function draw(): void {
    const working = ROWS.find((row) => row.kind === busy);
    render(
      html`
        <h2 class="cl-import-heading">${text('import-export.exportTitle')}</h2>
        <ul class="cl-import-export-list">${ROWS.map(line)}</ul>
        ${
          working === undefined
            ? nothing
            : html`<lc-progress-bar indeterminate label=${text('import-export.exporting', { file: working.file })}></lc-progress-bar>`
        }
        <p class="cl-import-text">
          <a href=${href(settingsPath('backup'))}>${text('import-export.exportBackup')}</a>
        </p>
      `,
      element,
    );
  }

  draw();
  return element;
}
