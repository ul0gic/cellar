import { html, render } from '@lightstart/light/html';
import { setAppBar } from '../../app/shell.ts';
import type { ScreenContext } from '../../app/types.ts';
import { type TextKey, text } from '../../text/index.ts';
import { csvPanel } from './csv.ts';
import { exportPanel } from './exports.ts';
import { recipesPanel } from './recipes.ts';
import { webPanel } from './web.ts';
import './index.css';

interface Tab {
  readonly slug: string;
  readonly label: TextKey;
  readonly panel: (ctx: ScreenContext) => HTMLElement;
}

const TABS: readonly Tab[] = [
  { slug: 'bottles', label: 'import-export.tab.bottles', panel: (ctx) => csvPanel('bottles', ctx) },
  { slug: 'ingredients', label: 'import-export.tab.ingredients', panel: (ctx) => csvPanel('ingredients', ctx) },
  { slug: 'recipes', label: 'import-export.tab.recipes', panel: () => recipesPanel() },
  { slug: 'url', label: 'import-export.tab.url', panel: (ctx) => webPanel(ctx) },
  { slug: 'export', label: 'import-export.tab.export', panel: () => exportPanel() },
];

const FOCUS_TAB = 'importTabFocus';

export function screen(ctx: ScreenContext): HTMLElement {
  setAppBar({});
  const element = document.createElement('section');
  element.className = 'cl-import cl-reading';
  const found = TABS.findIndex((tab) => tab.slug === ctx.params.tab);
  const active = found === -1 ? 0 : found;
  const panel = TABS[active]?.panel(ctx) ?? document.createElement('div');

  const choose = (event: Event): void => {
    const index = event instanceof CustomEvent && typeof event.detail === 'number' ? event.detail : active;
    const tab = TABS[index];
    if (index !== active && tab !== undefined) {
      ctx.navigate(`/import/${tab.slug}`, { state: { [FOCUS_TAB]: true } });
    }
  };

  render(
    html`
      <h1 class="cl-import-title">${text('import-export.title')}</h1>
      <lc-tabs variant="underline" .activeTab=${active} aria-label=${text('import-export.tabs')} @tab-change=${choose}>
        ${TABS.map((tab) => html`<button slot="tab" type="button" class="cl-import-tab">${text(tab.label)}</button>`)}
        ${TABS.map((_tab, index) => html`<div slot="panel">${index === active ? panel : ''}</div>`)}
      </lc-tabs>
    `,
    element,
  );

  const state: unknown = history.state;
  if (typeof state === 'object' && state !== null && Reflect.get(state, FOCUS_TAB) === true) {
    requestAnimationFrame(() => element.querySelectorAll<HTMLElement>('.cl-import-tab')[active]?.focus());
  }
  return element;
}
