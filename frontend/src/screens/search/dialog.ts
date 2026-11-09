import { foldName, type ImageRef, type SearchResult } from '@cellar/contract';
import type { SearchDoc } from '@lightstart/light/components/types.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import './search.css';

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

function marked(title: string, query: string): TemplateResult {
  const at = query === '' ? -1 : title.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) {
    return html`${title}`;
  }
  return html`${title.slice(0, at)}<mark class="cl-search-match">${title.slice(at, at + query.length)}</mark>${title.slice(
    at + query.length,
  )}`;
}

export function screen(): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-search';
  let phase: Phase = { kind: 'idle' };
  let query = '';
  let sequence = 0;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let loading = false;
  const rows = new Map<string, Row>();
  const placeholders = new Map<string, string>();
  const placeholder = (hash: string): string => {
    const known = placeholders.get(hash);
    if (known !== undefined) {
      return known;
    }
    const url = thumbHashDataUrl(hash);
    placeholders.set(hash, url);
    return url;
  };

  const leave = (): void => {
    element.dispatchEvent(new CustomEvent('cl-dismiss', { bubbles: true }));
  };

  const groupDocs = (
    docs: SearchDoc[],
    groups: string[],
    name: string,
    total: number,
    hits: readonly (Row & { readonly id: string })[],
    more: { readonly title: string; readonly href: string },
  ): void => {
    if (total === 0) {
      return;
    }
    const group = name;
    groups.push(group);
    const all =
      total > hits.length
        ? [...hits, { ...more, id: `more-${name}`, kind: 'more' as const, hint: '', image: null }]
        : hits;
    for (const row of all) {
      rows.set(row.id, row);
      docs.push({ id: row.id, group, title: row.title, hint: row.hint, href: row.href });
    }
  };

  const bottleStatus = (bottle: 'sealed' | 'open' | 'finished'): string =>
    bottle === 'open' ? text('bulb.open') : bottle === 'sealed' ? text('bulb.sealed') : text('bulb.finished');

  const docsOf = (result: SearchResult): { docs: SearchDoc[]; groups: string[] } => {
    rows.clear();
    const docs: SearchDoc[] = [];
    const groups: string[] = [];
    const q = encodeURIComponent(result.correctedQuery ?? result.query);
    groupDocs(
      docs,
      groups,
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
      docs,
      groups,
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
      docs,
      groups,
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
    return { docs, groups };
  };

  const renderResult = (doc: SearchDoc): TemplateResult => {
    const row = rows.get(String(doc.id));
    if (row === undefined) {
      return html`${doc.title}`;
    }
    const shown = phase.kind === 'ready' ? (phase.result.correctedQuery ?? phase.result.query) : query;
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
              placeholder=${row.image.thumbhash === null ? nothing : placeholder(row.image.thumbhash)}
            ></lc-image>`;
    return html`${art}<span class="cl-search-text">
        <span class="cl-search-title">${row.kind === 'more' ? row.title : marked(row.title, shown)}</span>
        ${row.hint === '' ? nothing : html`<span class="cl-search-hint">${row.hint}</span>`}
      </span>`;
  };

  const status = (): TemplateResult | typeof nothing => {
    if (phase.kind === 'failed') {
      return html`<p class="cl-search-status" role="status">${text('search.failed')}</p>`;
    }
    if (query.trim() === '' || phase.kind === 'idle') {
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
  };

  const draw = (answered = false): void => {
    const shown = phase.kind === 'ready' && query.trim() !== '' ? docsOf(phase.result) : { docs: [], groups: [] };
    render(
      html`<lc-modal
        open
        size="lg"
        class="cl-search-modal"
        @modal-close=${leave}
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
            .query=${query}
            .docs=${shown.docs}
            .groups=${shown.groups}
            .renderResult=${renderResult}
            ?loading=${loading}
            @search-input=${onInput}
            @search-select=${leaveSelected}
          ></lc-search>
          <lc-button variant="ghost" @click=${leave}>${text('search.cancel')}</lc-button>
        </div>
        ${status()}
        <p class="cl-search-keys" aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> ${text('search.keysMove')} <kbd>Enter</kbd> ${text('search.keysOpen')}
          <kbd>Esc</kbd> ${text('search.keysClose')}
        </p>
      </lc-modal>`,
      element,
    );
    if (!answered) {
      return;
    }
    const search = element.querySelector('lc-search');
    if (search !== null && phase.kind === 'ready') {
      const exact = foldName(phase.result.correctedQuery ?? phase.result.query);
      search.active = shown.docs.slice(0, RESULT_LIMIT).findIndex((doc) => foldName(doc.title) === exact);
    }
    requestAnimationFrame(() => {
      performance.mark(PAINT_MARK);
      if (performance.getEntriesByName(INPUT_MARK, 'mark').length > 0) {
        performance.measure('cellar:search', INPUT_MARK, PAINT_MARK);
        performance.clearMarks(INPUT_MARK);
      }
    });
  };

  async function fetchResults(q: string, ticket: number): Promise<void> {
    try {
      const result = await call('search', { query: { q } });
      if (ticket === sequence) {
        phase = { kind: 'ready', result };
        loading = false;
        draw(true);
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (ticket === sequence) {
        phase = { kind: 'failed' };
        loading = false;
        draw(true);
      }
    }
  }

  function onInput(event: Event): void {
    const value: unknown = event instanceof CustomEvent ? event.detail : '';
    query = typeof value === 'string' ? value : '';
    sequence += 1;
    const ticket = sequence;
    if (settle !== null) {
      clearTimeout(settle);
      settle = null;
    }
    const q = query.trim().slice(0, QUERY_MAX);
    if (q === '') {
      phase = { kind: 'idle' };
      loading = false;
      draw();
      return;
    }
    performance.mark(INPUT_MARK);
    if (!loading) {
      loading = true;
      draw();
    }
    settle = setTimeout(() => {
      settle = null;
      void fetchResults(q, ticket);
    }, SETTLE_MS);
  }

  function leaveSelected(): void {
    sequence += 1;
  }

  draw();
  return element;
}
