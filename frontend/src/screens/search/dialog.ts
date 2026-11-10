import { foldName, type ImageRef, type SearchResult } from '@cellar/contract';
import type { SearchDoc } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { computed, effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import '../../design-system/cl-plate.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/modal.ts';
import '../../design-system/lc/search.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import './search.css';

export const tag = 'cl-screen-search-dialog';

// Keystroke to paint is budgeted at 150 ms; a 25 ms settle coalesces key repeats and leaves the rest to the server and paint.
const SETTLE_MS = 25;
const QUERY_MAX = 100;
const RESULT_LIMIT = 64;
const INPUT_MARK = 'cellar:search-input';
const PAINT_MARK = 'cellar:search-painted';

type Kind = 'recipe' | 'ingredient' | 'bottle' | 'more';

interface Row {
  readonly kind: Kind;
  readonly title: string;
  readonly hint: string;
  readonly image: ImageRef | null;
  readonly href: string;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'ready'; readonly result: SearchResult }
  | { readonly kind: 'failed' };

interface Shown {
  readonly docs: SearchDoc[];
  readonly groups: string[];
  readonly rows: ReadonlyMap<string, Row>;
}

const NOTHING_SHOWN: Shown = { docs: [], groups: [], rows: new Map() };

function marked(title: string, query: string): TemplateResult {
  const at = query === '' ? -1 : title.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) {
    return html`${title}`;
  }
  return html`${title.slice(0, at)}<mark class="cl-search-match">${title.slice(at, at + query.length)}</mark>${title.slice(
    at + query.length,
  )}`;
}

function groupDocs(
  shown: { docs: SearchDoc[]; groups: string[]; rows: Map<string, Row> },
  name: string,
  total: number,
  hits: readonly (Row & { readonly id: string })[],
  more: { readonly title: string; readonly href: string },
): void {
  if (total === 0) {
    return;
  }
  shown.groups.push(name);
  const all =
    total > hits.length
      ? [...hits, { ...more, id: `more-${name}`, kind: 'more' as const, hint: '', image: null }]
      : hits;
  for (const row of all) {
    shown.rows.set(row.id, row);
    shown.docs.push({ id: row.id, group: name, title: row.title, hint: row.hint, href: row.href });
  }
}

function bottleStatus(bottle: 'sealed' | 'open' | 'finished'): string {
  return bottle === 'open' ? text('bulb.open') : bottle === 'sealed' ? text('bulb.sealed') : text('bulb.finished');
}

function shownFor(result: SearchResult): Shown {
  const shown = { docs: [], groups: [], rows: new Map<string, Row>() };
  const q = encodeURIComponent(result.correctedQuery ?? result.query);
  groupDocs(
    shown,
    text('search.recipes'),
    result.recipes.total,
    result.recipes.items.map((hit) => ({
      id: `recipe-${hit.id}`,
      kind: 'recipe',
      title: hit.name,
      hint: hit.canMake ? text('search.canMake') : text('search.cannotMake'),
      image: hit.image,
      href: `/recipes/${hit.id}`,
    })),
    {
      title: text('search.showAllRecipes', { count: formatNumber(result.recipes.total) }),
      href: `/recipes?status=all&q=${q}`,
    },
  );
  groupDocs(
    shown,
    text('search.ingredients'),
    result.ingredients.total,
    result.ingredients.items.map((hit) => ({
      id: `ingredient-${hit.id}`,
      kind: 'ingredient',
      title: hit.name,
      hint: hit.parent?.name ?? text('search.topLevel'),
      image: null,
      href: `/ingredients/${hit.id}`,
    })),
    {
      title: text('search.showAllIngredients', { count: formatNumber(result.ingredients.total) }),
      href: `/ingredients?q=${q}`,
    },
  );
  groupDocs(
    shown,
    text('search.bottles'),
    result.bottles.total,
    result.bottles.items.map((hit) => ({
      id: `bottle-${hit.id}`,
      kind: 'bottle',
      title: hit.name,
      hint: text('search.bottleLine', { status: bottleStatus(hit.status), ingredient: hit.ingredient.name }),
      image: null,
      href: hit.status === 'finished' ? '/shelf/history' : `/shelf?q=${encodeURIComponent(hit.name)}`,
    })),
    { title: text('search.showAllBottles', { count: formatNumber(result.bottles.total) }), href: `/shelf?q=${q}` },
  );
  return shown;
}

class SearchDialog extends View {
  readonly query = signal('');
  readonly phase = signal<Phase>({ kind: 'idle' });
  readonly loading = signal(false);
  readonly shown = computed(() => {
    const phase = this.phase.value;
    return phase.kind === 'ready' && this.query.value.trim() !== '' ? shownFor(phase.result) : NOTHING_SHOWN;
  });
  private sequence = 0;
  private readonly placeholders = new Map<string, string>();

  connected(): void {
    this.classList.add('cl-search');
    let settle: ReturnType<typeof setTimeout> | null = null;
    const cancelSettle = (): void => {
      if (settle !== null) {
        clearTimeout(settle);
        settle = null;
      }
    };
    const typing = effect(() => {
      const q = this.query.value.trim().slice(0, QUERY_MAX);
      cancelSettle();
      this.sequence += 1;
      const ticket = this.sequence;
      if (q === '') {
        this.phase.value = { kind: 'idle' };
        this.loading.value = false;
        return;
      }
      performance.mark(INPUT_MARK);
      this.loading.value = true;
      settle = setTimeout(() => {
        settle = null;
        void this.fetchResults(q, ticket);
      }, SETTLE_MS);
    });
    this.$own(() => {
      typing.dispose();
      cancelSettle();
    });
  }

  private placeholder(hash: string): string {
    const known = this.placeholders.get(hash);
    if (known !== undefined) {
      return known;
    }
    const url = thumbHashDataUrl(hash);
    this.placeholders.set(hash, url);
    return url;
  }

  private leave(): void {
    this.dispatchEvent(new CustomEvent('cl-dismiss', { bubbles: true }));
  }

  private async fetchResults(q: string, ticket: number): Promise<void> {
    try {
      const result = await call('search', { query: { q } });
      if (ticket === this.sequence) {
        this.phase.value = { kind: 'ready', result };
        this.loading.value = false;
        await this.painted();
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (ticket === this.sequence) {
        this.phase.value = { kind: 'failed' };
        this.loading.value = false;
        await this.painted();
      }
    }
  }

  private async painted(): Promise<void> {
    await this.$whenUpdated();
    const phase = this.phase.peek();
    const search = this.querySelector('lc-search');
    if (search !== null && phase.kind === 'ready') {
      const exact = foldName(phase.result.correctedQuery ?? phase.result.query);
      search.active = this.shown
        .peek()
        .docs.slice(0, RESULT_LIMIT)
        .findIndex((doc) => foldName(doc.title) === exact);
    }
    requestAnimationFrame(() => {
      performance.mark(PAINT_MARK);
      if (performance.getEntriesByName(INPUT_MARK, 'mark').length > 0) {
        performance.measure('cellar:search', INPUT_MARK, PAINT_MARK);
        performance.clearMarks(INPUT_MARK);
      }
    });
  }

  private onInput(event: Event): void {
    const value: unknown = event instanceof CustomEvent ? event.detail : '';
    this.query.value = typeof value === 'string' ? value : '';
  }

  private renderResult(doc: SearchDoc): TemplateResult {
    const row = this.shown.peek().rows.get(String(doc.id));
    if (row === undefined) {
      return html`${doc.title}`;
    }
    const phase = this.phase.peek();
    const highlighted =
      phase.kind === 'ready' ? (phase.result.correctedQuery ?? phase.result.query) : this.query.peek();
    const art =
      row.kind === 'more'
        ? html`<span class="cl-search-thumb cl-search-more" aria-hidden="true"
            ><lc-icon name="arrow-right" aria-hidden="true"></lc-icon
          ></span>`
        : row.image === null
          ? html`<cl-plate
              class="cl-search-thumb"
              small
              kind=${row.kind === 'recipe' ? 'coupe' : 'bottle'}
              name=${row.title}
            ></cl-plate>`
          : html`<lc-image
              class="cl-search-thumb"
              src=${row.image.url}
              alt=""
              placeholder=${row.image.thumbhash === null ? nothing : this.placeholder(row.image.thumbhash)}
            ></lc-image>`;
    return html`${art}<span class="cl-search-text">
        <span class="cl-search-title">${row.kind === 'more' ? row.title : marked(row.title, highlighted)}</span>
        ${row.hint === '' ? nothing : html`<span class="cl-search-hint">${row.hint}</span>`}
      </span>`;
  }

  private status(): TemplateResult | typeof nothing {
    const phase = this.phase.value;
    if (phase.kind === 'failed') {
      return html`<p class="cl-search-status" role="status">${text('search.failed')}</p>`;
    }
    if (this.query.value.trim() === '' || phase.kind === 'idle') {
      return html`<p class="cl-search-status" role="status">${text('search.idle')}</p>`;
    }
    const result = phase.result;
    if (result.correctedQuery !== null) {
      return html`<p class="cl-search-status" role="status">
        ${text('search.correctedLead')} <strong>${result.correctedQuery}</strong>.
        ${text('search.correctedNone', { query: result.query })}
      </p>`;
    }
    return nothing;
  }

  render() {
    const shown = this.shown.value;
    return html`<lc-modal
      open
      size="lg"
      class="cl-search-modal"
      @modal-close=${() => this.leave()}
    >
      <h2 slot="header" class="cl-search-heading">${text('search.label')}</h2>
      <div class="cl-search-bar">
        <lc-search
          remote
          inline
          autofocus
          class="cl-search-field"
          placeholder=${text('search.placeholder')}
          limit=${RESULT_LIMIT}
          .query=${this.query.value}
          .docs=${shown.docs}
          .groups=${shown.groups}
          .renderResult=${(doc: SearchDoc) => this.renderResult(doc)}
          ?loading=${this.loading.value}
          @search-input=${(event: Event) => this.onInput(event)}
          @search-select=${() => {
            this.sequence += 1;
          }}
        ></lc-search>
        <lc-button variant="ghost" @click=${() => this.leave()}>${text('search.cancel')}</lc-button>
      </div>
      ${this.status()}
      <p class="cl-search-keys" aria-hidden="true">
        <kbd>↑</kbd><kbd>↓</kbd> ${text('search.keysMove')} <kbd>Enter</kbd> ${text('search.keysOpen')}
        <kbd>Esc</kbd> ${text('search.keysClose')}
      </p>
    </lc-modal>`;
  }
}

View.register(tag, SearchDialog);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SearchDialog;
  }
}
