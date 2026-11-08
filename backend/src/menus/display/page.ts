import type { Id } from '@cellar/contract';
import { escapeHtml, renderDocument } from './html.ts';

export type DisplayItem =
  | {
      readonly kind: 'recipe';
      readonly recipeId: Id;
      readonly name: string;
      readonly hostNote: string;
      readonly imageUrl: string | null;
    }
  | { readonly kind: 'ingredient'; readonly name: string; readonly hostNote: string; readonly imageUrl: string | null };

export interface DisplaySection {
  readonly name: string;
  readonly items: readonly DisplayItem[];
}

export interface DisplayMenu {
  readonly name: string;
  readonly date: string;
  readonly sections: readonly DisplaySection[];
}

export interface DisplayPageContext {
  readonly assetBase: string;
  readonly appVersion: string;
  readonly menuPath: string;
  readonly stateVersion: string;
  readonly today: Date;
}

type Tier = 'grand' | 'standard' | 'compact';

interface Layout {
  readonly tier: Tier;
  readonly perColumn: number;
}

const ITEMS_PER_PAGE = 16;

const RECIPE_PLATE =
  '<path d="M33 14l3 74h28l3-74z"/><path d="M34 34h32"/><rect x="41" y="40" width="13" height="12" rx="2.5"/><rect x="45" y="58" width="13" height="12" rx="2.5"/>';
const NEAT_PLATE =
  '<path d="M25 40l4 46h42l4-46z"/><path d="M27 58h46"/><rect x="38" y="62" width="17" height="15" rx="3"/>';

function layoutFor(visible: number): Layout {
  if (visible <= 6) {
    return { tier: 'grand', perColumn: 3 };
  }
  if (visible <= 9) {
    return { tier: 'standard', perColumn: 3 };
  }
  return { tier: 'compact', perColumn: 4 };
}

function formatMenuDate(date: string, today: Date): string {
  const day = new Date(`${date}T00:00:00Z`);
  const sameYear = day.getUTCFullYear() === today.getUTCFullYear();
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(day);
}

function renderItem(item: DisplayItem, menuPath: string): string {
  const plate =
    item.imageUrl === null
      ? `<div class="plate none"><svg viewBox="0 0 100 100" aria-hidden="true">${item.kind === 'recipe' ? RECIPE_PLATE : NEAT_PLATE}</svg></div>`
      : `<div class="plate"><img src="${escapeHtml(item.imageUrl)}" alt=""></div>`;
  const name =
    item.kind === 'recipe'
      ? `<a class="name" href="${menuPath}/r/${item.recipeId}">${escapeHtml(item.name)}</a>`
      : `<div class="name">${escapeHtml(item.name)}</div>`;
  const note = item.hostNote === '' ? '' : `<div class="note">${escapeHtml(item.hostNote)}</div>`;
  return `<div class="item">${plate}<div>${name}${note}</div></div>`;
}

interface Column {
  readonly heading: string;
  readonly items: readonly DisplayItem[];
}

function columnsOf(sections: readonly DisplaySection[], perColumn: number): Column[] {
  const columns: Column[] = [];
  for (const section of sections) {
    for (let start = 0; start < section.items.length; start += perColumn) {
      columns.push({ heading: section.name, items: section.items.slice(start, start + perColumn) });
    }
  }
  return columns;
}

function pagesOf(sections: readonly DisplaySection[]): DisplaySection[][] {
  const pages: DisplaySection[][] = [];
  let page: DisplaySection[] = [];
  let count = 0;
  for (const section of sections) {
    let rest = section.items;
    while (rest.length > 0) {
      const room = ITEMS_PER_PAGE - count;
      page.push({ name: section.name, items: rest.slice(0, room) });
      count += Math.min(room, rest.length);
      rest = rest.slice(room);
      if (count === ITEMS_PER_PAGE) {
        pages.push(page);
        page = [];
        count = 0;
      }
    }
  }
  if (page.length > 0) {
    pages.push(page);
  }
  return pages;
}

function renderColumns(sections: readonly DisplaySection[], perColumn: number, menuPath: string): string {
  return columnsOf(sections, perColumn)
    .map(
      (column) =>
        `<section class="col"><h2>${escapeHtml(column.heading)}</h2>${column.items.map((item) => renderItem(item, menuPath)).join('')}</section>`,
    )
    .join('');
}

function renderDots(index: number, total: number): string {
  const dots = Array.from({ length: total }, (_, i) => (i === index ? '<i class="on"></i>' : '<i></i>')).join('');
  return `<div class="foot"><span class="dots" role="img" aria-label="Page ${index + 1} of ${total}">${dots}</span></div>`;
}

function renderBody(menu: DisplayMenu, visible: number, layout: Layout, menuPath: string): string {
  if (visible === 0) {
    return `<div class="cols"><p class="note">Nothing on the menu yet. Ask the host what's pouring.</p></div>`;
  }
  if (visible <= ITEMS_PER_PAGE) {
    return `<div class="cols">${renderColumns(menu.sections, layout.perColumn, menuPath)}</div>`;
  }
  const pages = pagesOf(menu.sections);
  return pages
    .map(
      (page, index) =>
        `<div class="page"${index === 0 ? '' : ' hidden'}><div class="cols">${renderColumns(page, layout.perColumn, menuPath)}</div>${renderDots(index, pages.length)}</div>`,
    )
    .join('');
}

export function renderDisplayPage(menu: DisplayMenu, context: DisplayPageContext): string {
  const visible = menu.sections.reduce((sum, section) => sum + section.items.length, 0);
  const layout = layoutFor(visible);
  const head = `<header class="head"><h1>${escapeHtml(menu.name)}</h1><div class="date"><time datetime="${escapeHtml(menu.date)}">${formatMenuDate(menu.date, context.today)}</time></div><div class="orn"><i></i></div></header>`;
  const stale = `<p class="foot stale" hidden>Can't reach Cellar. Showing the menu as of <span></span>.</p>`;
  return renderDocument({
    title: menu.name,
    assetBase: context.assetBase,
    version: context.appVersion,
    refresh: true,
    bodyAttributes: ` class="${layout.tier}" data-version="${escapeHtml(context.stateVersion)}"`,
    main: `${head}${renderBody(menu, visible, layout, context.menuPath)}${stale}`,
    script: true,
  });
}
