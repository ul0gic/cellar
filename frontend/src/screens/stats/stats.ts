import type { Stats } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import { formatDate, formatNumber, formatWholeMoney } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { follow, type LoadState, pricesSwitch, waiting, watch } from '../shelf/parts/kit.ts';
import './stats.css';

type ChartId = 'finished' | 'spend';

interface Bars {
  readonly id: ChartId;
  readonly heading: string;
  readonly label: string;
  readonly valueLabel: string;
  readonly data: readonly { readonly label: string; readonly value: number }[];
  readonly format: (value: number) => string;
  readonly variant: 'primary' | 'secondary';
  readonly note: string;
  readonly empty: string;
}

const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function hint(line: string): TemplateResult {
  return html`<p class="cl-kit-meta">${line}</p>`;
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-stats';
  const stats = resourceFor('getStats', {}, { tags: ['stats', 'shelf', 'shopping', 'wishlists', 'notes'] });
  const asTable = new Set<ChartId>();
  let state: LoadState | null = null;

  const currency = (): string => {
    const session = ctx.person.current();
    if (session === null) {
      throw new Error('Stats prices need a signed-in person');
    }
    return session.household.currency;
  };

  const tile = (heading: string, value: string, sub: string): TemplateResult => html`<lc-stat
    class="cl-stats-tile"
    title=${heading}
    .value=${value}
    desc=${sub}
  ></lc-stat>`;

  const figures = (data: Stats): TemplateResult => {
    const prices = data.prices;
    return html`
      ${tile(
        text('stats.canMake'),
        formatNumber(data.recipes.canMake),
        data.recipes.canMake === 0
          ? text('stats.canMakeEmpty')
          : text('stats.canMakeSub', {
              total: formatNumber(data.recipes.total),
              percent: formatNumber(Math.round(data.recipes.percent)),
            }),
      )}
      ${tile(
        text('stats.onShelf'),
        formatNumber(data.shelf.bottles),
        data.shelf.bottles === 0
          ? text('stats.onShelfEmpty')
          : text('stats.onShelfSub', { open: formatNumber(data.shelf.open), sealed: formatNumber(data.shelf.sealed) }),
      )}
      ${
        prices === undefined
          ? tile(
              text('stats.lists'),
              formatNumber(data.lists.shoppingListItems),
              text('stats.listsSub', { wishlist: formatNumber(data.lists.wishlistItems) }),
            )
          : tile(
              text('stats.barValue'),
              formatWholeMoney(prices.barValueMinor, currency()),
              text('stats.barValueSub', {
                known: formatNumber(prices.barValueCoverage.known),
                of: formatNumber(prices.barValueCoverage.of),
              }),
            )
      }
    `;
  };

  const panel = (
    id: string,
    heading: string,
    content: TemplateResult,
    wideTile = false,
  ): TemplateResult => html`<section
    class=${wideTile ? 'cl-stats-panel cl-stats-span' : 'cl-stats-panel'}
    aria-labelledby=${id}
  >
    <h2 class="cl-stats-heading" id=${id}>${heading}</h2>
    ${content}
  </section>`;

  const ranked = (rows: readonly { name: string; value: string; link: string | null }[]): TemplateResult =>
    html`<ul class="cl-kit-list cl-stats-ranked">
      ${rows.map(
        (row) => html`<li class="cl-kit-row">
          ${
            row.link === null
              ? html`<span class="cl-kit-row-text">${row.name}</span>`
              : html`<a class="cl-kit-row-link cl-kit-row-text" href=${href(row.link)}>${row.name}</a>`
          }
          <span class="cl-kit-meta">${row.value}</span>
        </li>`,
      )}
    </ul>`;

  const bars = (chart: Bars): TemplateResult => {
    const id = `cl-stats-${chart.id}`;
    const table = asTable.has(chart.id);
    if (chart.data.length === 0) {
      return panel(id, chart.heading, hint(chart.empty));
    }
    return panel(
      id,
      chart.heading,
      html`
        ${
          table
            ? html`<table class="cl-stats-table">
                <caption class="cl-vh">${chart.label}</caption>
                <thead><tr><th scope="col">${text('stats.year')}</th><th scope="col">${chart.valueLabel}</th></tr></thead>
                <tbody>
                  ${chart.data.map((datum) => html`<tr><th scope="row">${datum.label}</th><td>${chart.format(datum.value)}</td></tr>`)}
                </tbody>
              </table>`
            : html`<lc-bar-chart
                class="cl-stats-chart"
                label=${chart.label}
                show-values
                variant=${chart.variant}
                .data=${chart.data}
                .formatValue=${chart.format}
              ></lc-bar-chart>`
        }
        ${chart.note === '' ? nothing : hint(chart.note)}
        <details
          class="cl-stats-disclose"
          ?open=${table}
          @toggle=${(event: Event) => {
            const open = event.currentTarget instanceof HTMLDetailsElement && event.currentTarget.open;
            if (open === table) {
              return;
            }
            if (open) {
              asTable.add(chart.id);
            } else {
              asTable.delete(chart.id);
            }
            if (state !== null) {
              draw(state);
            }
          }}
        >
          <summary>${table ? text('chart.showChart') : text('chart.showTable')}</summary>
        </details>
      `,
    );
  };

  const lists = (data: Stats): TemplateResult => html`
    ${panel(
      'cl-stats-buy',
      text('stats.buyNext'),
      data.buyNext.length === 0
        ? hint(text('stats.buyNextEmpty'))
        : ranked(
            data.buyNext.map((item) => ({
              name: item.ingredient.name,
              value:
                item.unlocks === 1
                  ? text('stats.buyNextOne')
                  : text('stats.buyNextValue', { count: formatNumber(item.unlocks) }),
              link: `/ingredients/${item.ingredient.id}`,
            })),
          ),
    )}
    ${panel(
      'cl-stats-rated',
      text('stats.topRated'),
      data.topRated.length === 0
        ? hint(text('stats.topRatedEmpty'))
        : ranked(
            data.topRated.map((row) => ({
              name: row.name,
              value:
                row.rating.average === null
                  ? ''
                  : text('stats.ratedValue', {
                      average: oneDecimal.format(row.rating.average),
                      count: formatNumber(row.rating.count),
                    }),
              link: row.target.type === 'recipe' ? `/recipes/${row.target.id}` : `/ingredients/${row.target.id}`,
            })),
          ),
    )}
    ${panel(
      'cl-stats-made',
      text('stats.mostMade'),
      data.mostMade.length === 0
        ? hint(text('stats.mostMadeEmpty'))
        : ranked(
            data.mostMade.map((row) => ({
              name: row.recipe.name,
              value:
                row.count === 1 ? text('stats.madeOnce') : text('stats.madeTimes', { count: formatNumber(row.count) }),
              link: `/recipes/${row.recipe.id}`,
            })),
          ),
    )}
    ${panel(
      'cl-stats-tastings',
      text('stats.tastings'),
      data.recentTastings.length === 0
        ? hint(text('stats.tastingsEmpty'))
        : ranked(
            data.recentTastings.map((row) => ({
              name: text('stats.tastingOn', { name: row.note.author.name, target: row.targetName }),
              value: formatDate(row.note.tastedOn, 'this-year'),
              link:
                row.note.target.type === 'recipe'
                  ? `/recipes/${row.note.target.id}`
                  : `/ingredients/${row.note.target.id}`,
            })),
          ),
    )}
  `;

  const charts = (data: Stats): TemplateResult => {
    const prices = data.prices;
    const priced = prices?.spendByYear ?? [];
    const known = priced.reduce((sum, entry) => sum + entry.coverage.known, 0);
    const of = priced.reduce((sum, entry) => sum + entry.coverage.of, 0);
    return html`
      ${panel(
        'cl-stats-category',
        text('stats.byCategory'),
        data.shelf.byRoot.length === 0
          ? hint(text('stats.byCategoryEmpty'))
          : html`<cl-stacked-bar
              label=${text('stats.byCategory')}
              .items=${data.shelf.byRoot.map((entry) => ({ name: entry.root.name, count: entry.bottles }))}
            ></cl-stacked-bar>`,
        true,
      )}
      ${bars({
        id: 'finished',
        heading: text('stats.finishedByYear'),
        label: text('stats.finishedChart'),
        valueLabel: text('stats.bottles'),
        data: data.finishedByYear.map((entry) => ({ label: String(entry.year), value: entry.bottles })),
        format: formatNumber,
        variant: 'secondary',
        note: '',
        empty: text('stats.finishedEmpty'),
      })}
      ${
        prices === undefined
          ? nothing
          : bars({
              id: 'spend',
              heading: text('stats.spentByYear'),
              label: text('stats.spendChart'),
              valueLabel: text('stats.spent'),
              data: priced.map((entry) => ({ label: String(entry.year), value: entry.spentMinor })),
              format: (value) => formatWholeMoney(value, currency()),
              variant: 'primary',
              note: text('stats.spendSub', { known: formatNumber(known), of: formatNumber(of) }),
              empty: text('stats.spendEmpty'),
            })
      }
    `;
  };

  const draw = (current: LoadState): void => {
    state = current;
    const data = stats.peek();
    render(
      html`
        <div class="cl-kit-head">
          <h1 class="cl-kit-title">${text('stats.title')}</h1>
          ${pricesSwitch(ctx.person)}
        </div>
        ${
          data === undefined
            ? waiting(current, stats, text('nav.stats'), 'cards')
            : html`<div class="cl-stats-grid">${figures(data)} ${charts(data)} ${lists(data)}</div>`
        }
      `,
      element,
    );
  };

  let stop = watch(element, [stats], draw);
  follow(element, ctx.person.subscribe, () => {
    stop();
    stop = watch(element, [stats], draw);
  });
  return element;
}
