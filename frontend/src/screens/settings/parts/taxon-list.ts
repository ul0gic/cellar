import type { LightElements } from '@lightstart/components/elements.js';
import type { FormField } from '@lightstart/components/types.js';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError } from '../../../app/api.ts';
import { settingsTaxonLists } from '../../../app/controllers/settings-taxon-lists.ts';
import { eventText, formValues, valueText } from '../../../app/events.ts';
import { actionFailed, problemText } from '../../../app/problems.ts';
import { dataChanged } from '../../../app/resources.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { confirm } from '../../../design-system/dialogs.ts';
import { formatNumber } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';
import { openSheet } from './sheet.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/dropdown.ts';
import '../../../design-system/lc/form.ts';
import '../../../design-system/lc/icon.ts';
import '../../../design-system/lc/input.ts';

export interface TaxonRow {
  readonly id: number;
  readonly name: string;
  readonly usageCount: number;
}

export interface TaxonKind {
  readonly key: string;
  readonly heading: string;
  readonly noun: string;
  readonly source: { readonly value: { readonly value: { readonly items: readonly TaxonRow[] } | undefined } };
  readonly dilution?: boolean;
  readonly describe?: (row: TaxonRow) => string;
  readonly create: (name: string, dilutionPercent: number) => Promise<unknown>;
  readonly rename: (row: TaxonRow, name: string) => Promise<unknown>;
  readonly remove: (row: TaxonRow) => Promise<unknown>;
}

const DILUTION_MAX = 100;

const RENAME_FIELDS: FormField[] = [{ name: 'name', type: 'text', label: text('settings.taxonomy.name') }];

function renameSheet(host: OverlayHost, kind: TaxonKind, row: TaxonRow): void {
  const fieldValues = signal<Record<string, unknown>>({ name: row.name });
  const fieldErrors = signal<Record<string, string>>({});
  const working = signal(false);
  const submit = async (): Promise<void> => {
    const trimmed = valueText(fieldValues.peek(), 'name').trim();
    if (trimmed.length === 0) {
      fieldErrors.value = { name: text('settings.taxonomy.nameMissing') };
      return;
    }
    fieldErrors.value = {};
    working.value = true;
    try {
      await kind.rename(row, trimmed);
      dataChanged('settings', 'recipes');
      sheet.close();
    } catch (failure) {
      if (failure instanceof ApiError && (failure.code === 'duplicate_name' || failure.code === 'validation_failed')) {
        fieldErrors.value = { name: problemText(failure) };
      } else {
        actionFailed(failure, () => void submit());
      }
    } finally {
      working.value = false;
    }
  };
  const sheet = openSheet(host, text('settings.taxonomy.renameTitle', { name: row.name }), () => ({
    body: html`<lc-form
      class="cl-settings-form"
      layout="stacked"
      .fields=${RENAME_FIELDS}
      .data=${fieldValues.value}
      .errors=${fieldErrors.value}
      @field-change=${(event: Event) => {
        const values = formValues(event);
        if (values !== null) {
          fieldValues.value = values;
        }
      }}
      @form-submit=${() => {
        if (!working.peek()) {
          void submit();
        }
      }}
    ></lc-form>`,
    footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button variant="primary" ?disabled=${working.value} @click=${() => void submit()}
        >${text('settings.taxonomy.renameSave')}</lc-button
      >`,
  }));
}

async function remove(host: OverlayHost, kind: TaxonKind, row: TaxonRow): Promise<void> {
  if (!host.isConnected) {
    return;
  }
  if (row.usageCount > 0) {
    const sure = await confirm(host, {
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
    dataChanged('settings', 'recipes');
  } catch (error) {
    actionFailed(error, () => void remove(host, kind, row));
  }
}

async function add(host: OverlayHost, kind: TaxonKind): Promise<void> {
  const draft = settingsTaxonLists.draft(kind.key);
  const name = draft.name.trim();
  const dilution = Number(draft.dilution);
  let invalid = name.length === 0 ? text('settings.taxonomy.nameMissing') : '';
  if (invalid === '' && kind.dilution === true) {
    const valid =
      draft.dilution.trim() !== '' && Number.isFinite(dilution) && dilution >= 0 && dilution <= DILUTION_MAX;
    invalid = valid ? '' : text('settings.taxonomy.dilutionInvalid');
  }
  if (invalid !== '') {
    settingsTaxonLists.patch(kind.key, { error: invalid });
    return;
  }
  settingsTaxonLists.patch(kind.key, { error: '', busy: true });
  try {
    await kind.create(name, dilution);
    dataChanged('settings', 'recipes');
    if (host.isConnected) {
      settingsTaxonLists.patch(kind.key, { name: '', dilution: '' });
    }
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'duplicate_name' || error.code === 'validation_failed')) {
      if (host.isConnected) {
        settingsTaxonLists.patch(kind.key, { error: problemText(error) });
      }
    } else {
      actionFailed(error, () => void add(host, kind));
    }
  } finally {
    if (host.isConnected) {
      settingsTaxonLists.patch(kind.key, { busy: false });
    }
  }
}

function openMenu(event: MouseEvent): void {
  const trigger = event.currentTarget;
  const menu =
    trigger instanceof Element
      ? trigger.parentElement?.querySelector<LightElements['lc-dropdown']>('lc-dropdown')
      : null;
  if (trigger instanceof Element && menu !== null && menu !== undefined) {
    menu.toggle(trigger);
  }
}

function rowView(host: OverlayHost, kind: TaxonKind, item: TaxonRow): TemplateResult {
  return html`<div class="cl-srow">
    <span class="cl-srow-text"
      ><b>${item.name}</b>${kind.describe === undefined ? nothing : html`<span>${kind.describe(item)}</span>`}</span
    >
    <lc-button
      variant="ghost"
      icon-only
      aria-haspopup="menu"
      aria-label=${text('settings.taxonomy.actions', { name: item.name })}
      @click=${openMenu}
      ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon
    ></lc-button>
    <lc-dropdown
      id=${`taxon-${kind.key}-${item.id}`}
      aria-label=${text('settings.taxonomy.actions', { name: item.name })}
      .items=${[
        { label: text('settings.taxonomy.rename'), icon: 'pencil', onClick: () => renameSheet(host, kind, item) },
        {
          label: text('settings.taxonomy.remove'),
          icon: 'trash-2',
          danger: true,
          onClick: () => void remove(host, kind, item),
        },
      ]}
    ></lc-dropdown>
  </div>`;
}

function section(host: OverlayHost, kind: TaxonKind): TemplateResult {
  const items = kind.source.value.value?.items ?? [];
  const draft = settingsTaxonLists.draft(kind.key);
  const headingId = `taxon-${kind.key}`;
  return html`<section class="cl-sgroup" aria-labelledby=${headingId}>
    <h2 id=${headingId}>${kind.heading}</h2>
    ${
      items.length === 0
        ? html`<p class="cl-muted">${text('settings.taxonomy.none')}</p>`
        : html`<div class="cl-panel">${items.map((item) => rowView(host, kind, item))}</div>`
    }
    <form
      class="cl-taxon-add"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!settingsTaxonLists.draft(kind.key).busy) {
          void add(host, kind);
        }
      }}
    >
      <lc-input
        label=${text('settings.taxonomy.add', { noun: kind.noun })}
        .value=${draft.name}
        error-message=${draft.error}
        @input=${(event: Event) => settingsTaxonLists.patch(kind.key, { name: eventText(event) })}
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
              @input=${(event: Event) => settingsTaxonLists.patch(kind.key, { dilution: eventText(event) })}
            ></lc-input>`
          : nothing
      }
      <lc-button variant="quiet" type="submit" ?disabled=${draft.busy}
        ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('settings.taxonomy.addButton')}</lc-button
      >
    </form>
  </section>`;
}

export function taxonSections(host: OverlayHost, kinds: readonly TaxonKind[]): TemplateResult {
  return html`${kinds.map((kind) => section(host, kind))}`;
}
