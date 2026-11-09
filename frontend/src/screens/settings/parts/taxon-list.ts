import type { LightElements } from '@lightstart/components/elements.js';
import type { ResourceHandle } from '@lightstart/light/controller';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError } from '../../../app/api.ts';
import { eventText } from '../../../app/events.ts';
import { watch } from '../../../app/load.ts';
import { actionFailed, problemText } from '../../../app/problems.ts';
import { invalidate } from '../../../app/resources.ts';
import { confirm } from '../../../design-system/dialogs.ts';
import { skeleton } from '../../../design-system/skeleton.ts';
import { formatNumber } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';
import { loadFailed } from './load-failed.ts';
import { openSheet } from './sheet.ts';

export interface TaxonRow {
  readonly id: number;
  readonly name: string;
  readonly usageCount: number;
}

export interface TaxonKind {
  readonly key: string;
  readonly heading: string;
  readonly noun: string;
  readonly source: Omit<ResourceHandle, 'peek'> & { peek(): { readonly items: readonly TaxonRow[] } | undefined };
  readonly dilution?: boolean;
  readonly describe?: (row: TaxonRow) => string;
  readonly create: (name: string, dilutionPercent: number) => Promise<unknown>;
  readonly rename: (row: TaxonRow, name: string) => Promise<unknown>;
  readonly remove: (row: TaxonRow) => Promise<unknown>;
}

interface Draft {
  name: string;
  dilution: string;
  error: string;
  busy: boolean;
}

const DILUTION_MAX = 100;

function renameSheet(kind: TaxonKind, row: TaxonRow): void {
  let name = row.name;
  let error = '';
  let busy = false;
  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    error = trimmed.length === 0 ? text('settings.taxonomy.nameMissing') : '';
    if (error !== '') {
      sheet.redraw();
      return;
    }
    busy = true;
    sheet.redraw();
    try {
      await kind.rename(row, trimmed);
      invalidate('settings', 'recipes');
      sheet.close();
    } catch (failure) {
      if (failure instanceof ApiError && (failure.code === 'duplicate_name' || failure.code === 'validation_failed')) {
        error = problemText(failure);
      } else {
        actionFailed(failure, () => void submit());
      }
    } finally {
      busy = false;
    }
    sheet.redraw();
  };
  const sheet = openSheet(text('settings.taxonomy.renameTitle', { name: row.name }), () => ({
    body: html`<form
      class="cl-sheet-form"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!busy) {
          void submit();
        }
      }}
    >
      <lc-input
        label=${text('settings.taxonomy.name')}
        .value=${name}
        error-message=${error}
        @input=${(event: Event) => {
          name = eventText(event);
        }}
      ></lc-input>
    </form>`,
    footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button variant="primary" ?disabled=${busy} @click=${() => void submit()}
        >${text('settings.taxonomy.renameSave')}</lc-button
      >`,
  }));
}

export function taxonLists(main: HTMLElement, screenName: string, kinds: readonly TaxonKind[]): void {
  const drafts = new Map<string, Draft>(
    kinds.map((kind) => [kind.key, { name: '', dilution: '', error: '', busy: false }]),
  );

  const draftOf = (kind: TaxonKind): Draft => {
    const draft = drafts.get(kind.key);
    if (draft === undefined) {
      throw new Error(`No draft for the ${kind.key} list`);
    }
    return draft;
  };

  const remove = async (kind: TaxonKind, row: TaxonRow): Promise<void> => {
    if (row.usageCount > 0) {
      const sure = await confirm({
        title: text('settings.taxonomy.removeTitle', { name: row.name }),
        message:
          row.usageCount === 1
            ? text('settings.taxonomy.removeBodyOne', { noun: kind.noun })
            : text('settings.taxonomy.removeBody', { count: formatNumber(row.usageCount), noun: kind.noun }),
        confirmLabel: text('settings.taxonomy.removeConfirm', { noun: kind.noun }),
        danger: true,
      });
      if (!sure) {
        return;
      }
    }
    try {
      await kind.remove(row);
      invalidate('settings', 'recipes');
    } catch (error) {
      actionFailed(error, () => void remove(kind, row));
    }
  };

  const add = async (kind: TaxonKind): Promise<void> => {
    const draft = draftOf(kind);
    const name = draft.name.trim();
    const dilution = Number(draft.dilution);
    draft.error = name.length === 0 ? text('settings.taxonomy.nameMissing') : '';
    if (draft.error === '' && kind.dilution === true) {
      const valid =
        draft.dilution.trim() !== '' && Number.isFinite(dilution) && dilution >= 0 && dilution <= DILUTION_MAX;
      draft.error = valid ? '' : text('settings.taxonomy.dilutionInvalid');
    }
    if (draft.error !== '') {
      redraw();
      return;
    }
    draft.busy = true;
    redraw();
    try {
      await kind.create(name, dilution);
      draft.name = '';
      draft.dilution = '';
      invalidate('settings', 'recipes');
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'duplicate_name' || error.code === 'validation_failed')) {
        draft.error = problemText(error);
      } else {
        actionFailed(error, () => void add(kind));
      }
    } finally {
      draft.busy = false;
    }
    redraw();
  };

  const openMenu = (event: MouseEvent, id: string): void => {
    const trigger = event.currentTarget;
    const menu = main.querySelector<LightElements['lc-dropdown']>(`#${id}`);
    if (trigger instanceof Element && menu !== null) {
      menu.toggle(trigger);
    }
  };

  const rowView = (kind: TaxonKind, item: TaxonRow): TemplateResult => {
    const menuId = `taxon-${kind.key}-${item.id}`;
    return html`<div class="cl-srow">
      <span class="cl-srow-text"
        ><b>${item.name}</b>${kind.describe === undefined ? nothing : html`<span>${kind.describe(item)}</span>`}</span
      >
      <lc-button
        variant="ghost"
        icon-only
        aria-haspopup="menu"
        aria-label=${text('settings.taxonomy.actions', { name: item.name })}
        @click=${(event: MouseEvent) => openMenu(event, menuId)}
        ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon
      ></lc-button>
      <lc-dropdown
        id=${menuId}
        aria-label=${text('settings.taxonomy.actions', { name: item.name })}
        .items=${[
          { label: text('settings.taxonomy.rename'), icon: 'pencil', onClick: () => renameSheet(kind, item) },
          {
            label: text('settings.taxonomy.remove'),
            icon: 'trash-2',
            danger: true,
            onClick: () => void remove(kind, item),
          },
        ]}
      ></lc-dropdown>
    </div>`;
  };

  const section = (kind: TaxonKind): TemplateResult => {
    const items = kind.source.peek()?.items ?? [];
    const draft = draftOf(kind);
    const headingId = `taxon-${kind.key}`;
    return html`<section class="cl-sgroup" aria-labelledby=${headingId}>
      <h2 id=${headingId}>${kind.heading}</h2>
      ${
        items.length === 0
          ? html`<p class="cl-muted">${text('settings.taxonomy.none')}</p>`
          : html`<div class="cl-panel">${items.map((item) => rowView(kind, item))}</div>`
      }
      <form
        class="cl-taxon-add"
        novalidate
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          if (!draft.busy) {
            void add(kind);
          }
        }}
      >
        <lc-input
          label=${text('settings.taxonomy.add', { noun: kind.noun })}
          .value=${draft.name}
          error-message=${draft.error}
          @input=${(event: Event) => {
            draft.name = eventText(event);
          }}
        ></lc-input>
        ${
          kind.dilution === true
            ? html`<lc-input
                label=${text('settings.taxonomy.dilution')}
                type="number"
                inputmode="decimal"
                min="0"
                max=${DILUTION_MAX}
                .value=${draft.dilution}
                @input=${(event: Event) => {
                  draft.dilution = eventText(event);
                }}
              ></lc-input>`
            : nothing
        }
        <lc-button variant="quiet" type="submit" ?disabled=${draft.busy}
          ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('settings.taxonomy.addButton')}</lc-button
        >
      </form>
    </section>`;
  };

  const { redraw } = watch(
    main,
    kinds.map((kind) => kind.source),
    ({ phase, retry }) => {
      if (phase === 'failed') {
        render(loadFailed(screenName, retry), main);
      } else if (phase === 'slow') {
        render(skeleton('rows', screenName), main);
      } else if (phase === 'ready') {
        render(html`${kinds.map(section)}`, main);
      }
    },
  );
}
