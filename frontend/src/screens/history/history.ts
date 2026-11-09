import type { BottleSummary, IsoDate } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventPage } from '../../app/events.ts';
import { type LoadState, watch } from '../../app/load.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { illustration } from '../../design-system/illustration.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate, formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { attempt, follow, money, waiting } from '../shelf/parts/kit.ts';
import './history.css';

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

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-reading cl-history';
  const stats = resourceFor('getStats', {}, { tags: ['stats', 'shelf'] });
  let stop: (() => void) | null = null;

  const listFor = () =>
    resourceFor(
      'listBottles',
      {
        query: {
          status: ['finished'],
          sort: 'finished',
          order: 'desc',
          page: pageNumber(ctx.query.get('page')),
          pageSize: PAGE_SIZE,
        },
      },
      { tags: ['shelf'] },
    );

  const changed = (): void => {
    invalidate('shelf', 'ingredients', 'recipes', 'stats');
  };

  const reopen = (bottle: BottleSummary): Promise<void> =>
    attempt(async () => {
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

  const line = (bottle: BottleSummary): string => {
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
    return price === null || price === undefined
      ? base
      : `${base} ${text('history.price', { price: money(price, ctx.person) })}`;
  };

  const row = (bottle: BottleSummary): TemplateResult => html`<li class="cl-kit-row">
    <span class="cl-kit-row-text">
      <span class="cl-kit-row-name">${bottle.name}</span>
      <span class="cl-kit-row-sub">${line(bottle)}</span>
    </span>
    <lc-button variant="ghost" aria-label=${text('history.reopenLabel', { name: bottle.name })} @click=${() => void reopen(bottle)}>
      <lc-icon name="rotate-ccw" aria-hidden="true"></lc-icon>${text('history.reopen')}
    </lc-button>
  </li>`;

  const groups = (items: readonly BottleSummary[]): TemplateResult[] => {
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
  };

  const head = (): TemplateResult | typeof nothing => {
    const byYear = stats.peek()?.finishedByYear;
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
  };

  const draw = (state: LoadState): void => {
    const list = listFor();
    const page = list.peek();
    const pending = waiting(state, list, text('nav.history'), 'rows');
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
                        current=${pageNumber(ctx.query.get('page'))}
                        total=${pages}
                        @change=${(event: Event) => {
                          const next = eventPage(event);
                          ctx.query.set({ page: next !== null && next > 1 ? String(next) : null }, 'push');
                        }}
                      ></lc-pagination>
                    </nav>`
                  : nothing
              }`;
    }
    render(html`${head()} ${body}`, element);
  };

  const start = (): void => {
    stop?.();
    stop = watch(element, [stats, listFor()], draw).stop;
  };
  follow(element, ctx.query.subscribe, start);
  follow(element, ctx.person.subscribe, start);
  start();
  return element;
}
