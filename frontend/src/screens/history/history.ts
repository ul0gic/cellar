import type { BottleSummary, IsoDate } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { eventPage } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setQuery } from '../../app/router.ts';
import { illustration } from '../../design-system/illustration.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import '../../design-system/cl-figure.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/pagination.ts';
import { attempt, money } from '../shelf/parts/kit.ts';
import './history.css';

export const tag = 'cl-screen-history-history';

// D-1 §8.30: list rows page at 100.
const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

function utcDay(date: IsoDate): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

function daysText(days: number): string {
  return days === 1 ? text('history.dayOne') : text('history.dayMany', { count: formatNumber(days) });
}

function pageNumber(value: string | null): number {
  const page = value === null ? Number.NaN : Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function changed(): void {
  dataChanged('shelf', 'ingredients', 'recipes', 'stats');
}

function reopen(bottle: BottleSummary): Promise<void> {
  return attempt(async () => {
    await call('reopenBottle', { params: { id: bottle.id } });
    changed();
    const finishedOn = bottle.finishedOn;
    toast({
      title: text('history.reopened', { name: bottle.name }),
      ...(finishedOn === null
        ? {}
        : {
            action: {
              label: text('toast.undo'),
              run: () =>
                void attempt(async () => {
                  await call('finishBottle', { params: { id: bottle.id }, body: { on: finishedOn } });
                  toast({ title: text('toast.undone') });
                  changed();
                }),
            },
          }),
    });
  });
}

function line(bottle: BottleSummary): string {
  const finished = bottle.finishedOn;
  if (finished === null) {
    return bottle.ingredient.name;
  }
  const base =
    bottle.openedOn === null
      ? text('history.lineNoOpen', {
          ingredient: bottle.ingredient.name,
          finished: formatDate(finished, 'this-year'),
        })
      : text('history.line', {
          ingredient: bottle.ingredient.name,
          opened: formatDate(bottle.openedOn, 'this-year'),
          finished: formatDate(finished, 'this-year'),
          days: daysText(daysBetween(bottle.openedOn, finished)),
        });
  const price = bottle.pricePaidMinor;
  return price === null || price === undefined ? base : `${base} ${text('history.price', { price: money(price) })}`;
}

function row(bottle: BottleSummary): TemplateResult {
  return html`<li class="cl-kit-row">
    <span class="cl-kit-row-text">
      <span class="cl-kit-row-name">${bottle.name}</span>
      <span class="cl-kit-row-sub">${line(bottle)}</span>
    </span>
    <lc-button variant="ghost" aria-label=${text('history.reopenLabel', { name: bottle.name })} @click=${() => void reopen(bottle)}>
      <lc-icon name="rotate-ccw" aria-hidden="true"></lc-icon>${text('history.reopen')}
    </lc-button>
  </li>`;
}

function groups(items: readonly BottleSummary[]): TemplateResult[] {
  const years = new Map<string, BottleSummary[]>();
  for (const bottle of items) {
    const year = bottle.finishedOn?.slice(0, 4) ?? '';
    years.set(year, [...(years.get(year) ?? []), bottle]);
  }
  return [...years].map(
    ([year, bottles]) => html`<section class="cl-kit-section" aria-labelledby=${`cl-history-${year}`}>
      <h2 class="cl-kit-section-title" id=${`cl-history-${year}`}>${year}</h2>
      <ul class="cl-kit-list">${bottles.map(row)}</ul>
    </section>`,
  );
}

class HistoryScreen extends View {
  readonly stats = apiResource('getStats', ['stats', 'shelf']);
  readonly list = apiResource('listBottles', ['shelf']);
  readonly state = loadState([this.list]);

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-reading', 'cl-history');
    this.stats.bind(this, {});
    this.list.bind(this, () => ({
      query: {
        status: ['finished'],
        sort: 'finished',
        order: 'desc',
        page: pageNumber(route.query.value.get('page')),
        pageSize: PAGE_SIZE,
      },
    }));
  }

  private head(): TemplateResult | typeof nothing {
    const byYear = this.stats.value.value?.finishedByYear;
    if (byYear === undefined) {
      return nothing;
    }
    const thisYear = new Date().getFullYear();
    const now = byYear.find((entry) => entry.year === thisYear)?.bottles ?? 0;
    const all = byYear.reduce((sum, entry) => sum + entry.bottles, 0);
    return html`<cl-figure
      value=${now}
      label=${now === 1 ? text('history.figureOne') : text('history.figureLabel')}
      sublabel=${all === 1 ? text('history.sinceOne') : text('history.since', { count: formatNumber(all) })}
    ></cl-figure>`;
  }

  render() {
    const page = this.list.value.value;
    const pending = waiting(this.state, text('nav.history'), 'rows');
    const pages = page === undefined ? 0 : Math.ceil(page.total / PAGE_SIZE);
    let body: TemplateResult | HTMLElement | typeof nothing | null = pending;
    if (pending === null && page !== undefined) {
      body =
        page.items.length === 0
          ? html`<lc-empty-state title=${text('history.emptyTitle')} description=${text('history.emptyBody')}>
              ${illustration('empty-shelf')}
            </lc-empty-state>`
          : html`${groups(page.items)}
              ${
                pages > 1
                  ? html`<nav class="cl-history-pager" aria-label=${text('history.pages')}>
                      <lc-pagination
                        current=${pageNumber(route.query.value.get('page'))}
                        total=${pages}
                        @change=${(event: Event) => {
                          const next = eventPage(event);
                          setQuery({ page: next !== null && next > 1 ? String(next) : null }, 'push');
                        }}
                      ></lc-pagination>
                    </nav>`
                  : nothing
              }`;
    }
    return html`${this.head()} ${body}`;
  }
}

View.register(tag, HistoryScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: HistoryScreen;
  }
}
