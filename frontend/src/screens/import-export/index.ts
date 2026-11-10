import View from '@lightstart/light';
import { html, type TemplateResult } from '@lightstart/light/html';
import { navigate } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { RouteParams } from '../../app/types.ts';
import '../../design-system/lc/tabs.ts';
import { type TextKey, text } from '../../text/index.ts';
import './csv.ts';
import './exports.ts';
import './recipes.ts';
import './web.ts';
import './index.css';

export const tag = 'cl-screen-import-export-index';

interface Tab {
  readonly slug: string;
  readonly label: TextKey;
  readonly panel: () => TemplateResult;
}

const TABS: readonly Tab[] = [
  {
    slug: 'bottles',
    label: 'import-export.tab.bottles',
    panel: () => html`<cl-import-export-csv-bottles></cl-import-export-csv-bottles>`,
  },
  {
    slug: 'ingredients',
    label: 'import-export.tab.ingredients',
    panel: () => html`<cl-import-export-csv-ingredients></cl-import-export-csv-ingredients>`,
  },
  {
    slug: 'recipes',
    label: 'import-export.tab.recipes',
    panel: () => html`<cl-import-export-recipes></cl-import-export-recipes>`,
  },
  { slug: 'url', label: 'import-export.tab.url', panel: () => html`<cl-import-export-web></cl-import-export-web>` },
  {
    slug: 'export',
    label: 'import-export.tab.export',
    panel: () => html`<cl-import-export-exports></cl-import-export-exports>`,
  },
];

const FOCUS_TAB = 'importTabFocus';

class ImportExportScreen extends View {
  params: RouteParams = {};

  get active(): number {
    const found = TABS.findIndex((tab) => tab.slug === this.params.tab);
    return found === -1 ? 0 : found;
  }

  connected(): void {
    this.classList.add('cl-import', 'cl-reading');
    setAppBar({});
  }

  firstUpdated(): void {
    const state: unknown = history.state;
    if (typeof state === 'object' && state !== null && Reflect.get(state, FOCUS_TAB) === true) {
      const frame = requestAnimationFrame(() =>
        this.querySelectorAll<HTMLElement>('.cl-import-tab')[this.active]?.focus(),
      );
      this.$own(() => cancelAnimationFrame(frame));
    }
  }

  choose(event: Event): void {
    const index = event instanceof CustomEvent && typeof event.detail === 'number' ? event.detail : this.active;
    const tab = TABS[index];
    if (index !== this.active && tab !== undefined) {
      navigate(`/import/${tab.slug}`, { state: { [FOCUS_TAB]: true } });
    }
  }

  render() {
    const active = this.active;
    return html`
      <h1 class="cl-import-title">${text('import-export.title')}</h1>
      <lc-tabs variant="underline" .activeTab=${active} aria-label=${text('import-export.tabs')} @tab-change=${(event: Event) => this.choose(event)}>
        ${TABS.map((tab) => html`<button slot="tab" type="button" class="cl-import-tab">${text(tab.label)}</button>`)}
        ${TABS.map((tab, index) => html`<div slot="panel">${index === active ? tab.panel() : ''}</div>`)}
      </lc-tabs>
    `;
  }
}

View.register(tag, ImportExportScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: ImportExportScreen;
  }
}
