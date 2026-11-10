import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { actionFailed } from '../../app/problems.ts';
import { href } from '../../app/router.ts';
import { settingsPath } from '../../app/routes.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/progress-bar.ts';
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

const tag = 'cl-import-export-exports';

class ExportPanel extends View {
  readonly busy = signal<ExportKind | null>(null);

  connected(): void {
    this.classList.add('cl-import-export');
  }

  async save(row: ExportRow): Promise<void> {
    this.busy.value = row.kind;
    try {
      download(await fetchExport(row.kind), row.file);
      toast({ title: text('import-export.exported', { file: row.file }) });
    } catch (error) {
      actionFailed(error, () => void this.save(row));
    } finally {
      this.busy.value = null;
    }
  }

  line(row: ExportRow): TemplateResult {
    return html`<li class="cl-import-export-row">
      <span class="cl-import-export-text">
        <span class="cl-import-export-name">${text(row.label)}</span>
        <span class="cl-import-export-hint">${text(row.hint)}</span>
      </span>
      <lc-button variant="quiet" ?disabled=${this.busy.value !== null} @click=${() => void this.save(row)}>
        <lc-icon name="download" aria-hidden="true"></lc-icon>${row.file}
      </lc-button>
    </li>`;
  }

  render() {
    const busy = this.busy.value;
    const working = ROWS.find((row) => row.kind === busy);
    return html`
      <h2 class="cl-import-heading">${text('import-export.exportTitle')}</h2>
      <ul class="cl-import-export-list">${ROWS.map((row) => this.line(row))}</ul>
      ${
        working === undefined
          ? nothing
          : html`<lc-progress-bar indeterminate label=${text('import-export.exporting', { file: working.file })}></lc-progress-bar>`
      }
      <p class="cl-import-text">
        <a href=${href(settingsPath('backup'))}>${text('import-export.exportBackup')}</a>
      </p>
    `;
  }
}

View.register(tag, ExportPanel);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: ExportPanel;
  }
}
