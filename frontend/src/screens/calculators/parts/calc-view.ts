import {
  type Calculator,
  type CalculatorInput,
  type CalculatorIssue,
  evaluateCalculator,
  LIMITS,
  validateCalculator,
} from '@cellar/contract';
import { registerFormFieldRenderer } from '@lightstart/components/form/field-renderers.js';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../../app/api.ts';
import { eventText, formValues } from '../../../app/events.ts';
import { loadState } from '../../../app/load.ts';
import { actionFailed, formErrors } from '../../../app/problems.ts';
import { apiResource } from '../../../app/resources.ts';
import { navigate, setScreenTitle } from '../../../app/router.ts';
import type { RouteParams } from '../../../app/types.ts';
import { confirm } from '../../../design-system/dialogs.ts';
import { illustration } from '../../../design-system/illustration.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/empty-state.ts';
import '../../../design-system/lc/form.ts';
import '../../../design-system/lc/icon.ts';
import '../../../design-system/lc/input.ts';
import '../../../design-system/lc/list-row.ts';
import { waiting } from '../../../design-system/load-view.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import './calc-view.css';

type Mode =
  | { readonly kind: 'use' }
  | { readonly kind: 'edit'; readonly id: number | null; readonly draft: CalculatorInput };

type Values = Readonly<Record<string, number | null>>;

const NEW_DRAFT = (): CalculatorInput => ({
  name: '',
  description: '',
  inputs: [{ key: 'volume', label: text('calculators.defaultInput'), defaultValue: 100, suffix: 'ml' }],
  outputs: [
    { key: 'result', label: text('calculators.defaultOutput'), expression: 'volume', decimals: 0, suffix: 'ml' },
  ],
});

function inputOf(calculator: Calculator): CalculatorInput {
  return {
    name: calculator.name,
    description: calculator.description,
    inputs: calculator.inputs.map((field) => ({ ...field })),
    outputs: calculator.outputs.map((field) => ({ ...field })),
  };
}

type InputRow = CalculatorInput['inputs'][number];
type OutputRow = CalculatorInput['outputs'][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInputRow(value: unknown): value is InputRow {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    typeof value.defaultValue === 'number' &&
    typeof value.suffix === 'string'
  );
}

function isOutputRow(value: unknown): value is OutputRow {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    typeof value.expression === 'string' &&
    typeof value.decimals === 'number' &&
    typeof value.suffix === 'string'
  );
}

function draftFrom(values: Record<string, unknown>, previous: CalculatorInput): CalculatorInput {
  return {
    ...previous,
    name: typeof values.name === 'string' ? values.name : previous.name,
    inputs: Array.isArray(values.inputs) ? values.inputs.filter(isInputRow) : previous.inputs,
    outputs: Array.isArray(values.outputs) ? values.outputs.filter(isOutputRow) : previous.outputs,
  };
}

function rowNames(draft: CalculatorInput): string[] {
  return [
    ...draft.inputs.map((_, index) => `inputs.${index}.key`),
    ...draft.outputs.flatMap((_, index) => [`outputs.${index}.expression`, `outputs.${index}.key`]),
  ];
}

function issueMessages(issues: readonly CalculatorIssue[]): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const issue of issues) {
    if (!(issue.path in messages)) {
      messages[issue.path] = issue.error.message;
    }
  }
  return messages;
}

function rowError(message: string | undefined): TemplateResult | typeof nothing {
  return message === undefined || message === '' ? nothing : html`<p class="cl-calc-error" role="alert">${message}</p>`;
}

registerFormFieldRenderer(
  'calculators-name',
  (_field, value, onChange, template) => template`
  <lc-input
    label=${text('calculators.name')}
    maxlength=${LIMITS.name.max}
    value=${typeof value === 'string' ? value : ''}
    @input=${(event: Event) => onChange(eventText(event))}
  ></lc-input>
`,
);

registerFormFieldRenderer('calculators-inputs', (field, value, onChange, template) => {
  const rows = Array.isArray(value) ? value.filter(isInputRow) : [];
  const patch = (index: number, change: Partial<InputRow>): void =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  return template`<fieldset class="cl-calc-group">
    <legend>${text('calculators.inputs')}</legend>
    ${rows.map(
      (row, index) => template`<div class="cl-calc-row">
        <lc-input
          label=${text('calculators.inputName', { position: index + 1 })}
          value=${row.key}
          @input=${(event: Event) => patch(index, { key: eventText(event) })}
        ></lc-input>
        <lc-input
          label=${text('calculators.inputTitle', { position: index + 1 })}
          value=${row.label}
          @input=${(event: Event) => patch(index, { label: eventText(event) })}
        ></lc-input>
        <lc-input
          label=${text('calculators.inputDefault', { position: index + 1 })}
          type="number"
          value=${String(row.defaultValue)}
          @input=${(event: Event) => patch(index, { defaultValue: Number(eventText(event)) || 0 })}
        ></lc-input>
        <lc-input
          label=${text('calculators.inputUnit', { position: index + 1 })}
          maxlength=${LIMITS.calculatorSuffix.max}
          value=${row.suffix}
          @input=${(event: Event) => patch(index, { suffix: eventText(event) })}
        ></lc-input>
        ${rowError(field.errors?.[`inputs.${index}.key`])}
        <lc-button
          variant="ghost"
          ?disabled=${rows.length === 1}
          @click=${() => onChange(rows.filter((_, at) => at !== index))}
        >${text('calculators.removeInput', { position: index + 1 })}</lc-button>
      </div>`,
    )}
    <lc-button
      ?disabled=${rows.length >= LIMITS.calculatorInputs.max}
      @click=${() => onChange([...rows, { key: `input_${rows.length + 1}`, label: '', defaultValue: 0, suffix: '' }])}
    >${text('calculators.addInput')}</lc-button>
  </fieldset>`;
});

registerFormFieldRenderer('calculators-outputs', (field, value, onChange, template) => {
  const rows = Array.isArray(value) ? value.filter(isOutputRow) : [];
  const patch = (index: number, change: Partial<OutputRow>): void =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const inputNames = typeof field.inputNames === 'string' ? field.inputNames : '';
  return template`<fieldset class="cl-calc-group">
    <legend>${text('calculators.results')}</legend>
    <p class="cl-calc-muted">${text('calculators.formulaHint', { inputs: inputNames })}</p>
    ${rows.map(
      (row, index) => template`<div class="cl-calc-row">
        <lc-input
          label=${text('calculators.resultLabel', { position: index + 1 })}
          value=${row.label}
          @input=${(event: Event) => patch(index, { label: eventText(event) })}
        ></lc-input>
        <lc-input
          label=${text('calculators.resultFormula', { position: index + 1 })}
          value=${row.expression}
          @input=${(event: Event) => patch(index, { expression: eventText(event) })}
        ></lc-input>
        <lc-input
          label=${text('calculators.resultUnit', { position: index + 1 })}
          maxlength=${LIMITS.calculatorSuffix.max}
          value=${row.suffix}
          @input=${(event: Event) => patch(index, { suffix: eventText(event) })}
        ></lc-input>
        ${rowError(field.errors?.[`outputs.${index}.expression`] ?? field.errors?.[`outputs.${index}.key`])}
        <lc-button
          variant="ghost"
          ?disabled=${rows.length === 1}
          @click=${() => onChange(rows.filter((_, at) => at !== index))}
        >${text('calculators.removeResult', { position: index + 1 })}</lc-button>
      </div>`,
    )}
    <lc-button
      ?disabled=${rows.length >= LIMITS.calculatorOutputs.max}
      @click=${() =>
        onChange([...rows, { key: `result_${rows.length + 1}`, label: '', expression: '', decimals: 1, suffix: '' }])}
    >${text('calculators.addResult')}</lc-button>
  </fieldset>`;
});

const FIXED_FIELDS: FormField[] = [
  { name: 'name', type: 'calculators-name', cmsType: 'calculators-name' },
  { name: 'inputs', type: 'calculators-inputs', cmsType: 'calculators-inputs' },
];

export class CalculatorScreen extends View {
  params: RouteParams = {};
  readonly list = apiResource('listCalculators', []);
  readonly state = loadState([this.list]);
  readonly mode = signal<Mode>({ kind: 'use' });
  readonly values = signal<Values>({});
  readonly shownId = signal<number | null>(null);
  readonly saving = signal(false);
  readonly serverErrors = signal<Readonly<Record<string, string>>>({});

  get selectedId(): number | null {
    return this.params.id === undefined ? null : Number(this.params.id);
  }

  connected(): void {
    this.classList.add('cl-calc-screen');
    this.list.bind(this, {});
    const follow = effect(() => {
      const calculator = this.selected();
      if (calculator === null) {
        return;
      }
      setScreenTitle(calculator.name);
      if (this.shownId.peek() !== calculator.id) {
        this.shownId.value = calculator.id;
        this.values.value = Object.fromEntries(calculator.inputs.map((field) => [field.key, field.defaultValue]));
      }
    });
    this.$own(() => follow.dispose());
  }

  selected(): Calculator | null {
    const calculators = this.list.value.value?.calculators ?? [];
    return calculators.find((calculator) => calculator.id === this.selectedId) ?? null;
  }

  edit(patch: (draft: CalculatorInput) => CalculatorInput): void {
    const mode = this.mode.peek();
    if (mode.kind === 'edit') {
      this.mode.value = { ...mode, draft: patch(mode.draft) };
    }
  }

  async save(): Promise<void> {
    const mode = this.mode.peek();
    if (mode.kind !== 'edit') {
      return;
    }
    const { id, draft } = mode;
    this.saving.value = true;
    this.serverErrors.value = {};
    try {
      const saved =
        id === null
          ? await call('createCalculator', { body: draft })
          : await call('replaceCalculator', { params: { id }, body: draft });
      await this.list.refresh();
      this.mode.value = { kind: 'use' };
      this.saving.value = false;
      toast({ title: text('calculators.saved') });
      if (saved.id !== this.selectedId && this.isConnected) {
        navigate(`/calculators/${saved.id}`);
      }
    } catch (error) {
      this.saving.value = false;
      if (error instanceof ApiError && error.fields.length > 0) {
        const { fields, rest } = formErrors(error, rowNames(draft));
        this.serverErrors.value = fields;
        if (rest.length > 0 || Object.keys(fields).length === 0) {
          actionFailed(error, () => void this.save());
        }
      } else {
        actionFailed(error, () => void this.save());
      }
    }
  }

  async removeCalculator(calculator: Calculator): Promise<void> {
    const sure = await confirm(this, {
      title: text('calculators.deleteTitle', { name: calculator.name }),
      message: text('calculators.deleteBody'),
      confirmLabel: text('calculators.delete'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteCalculator', { params: { id: calculator.id } });
      await this.list.refresh();
      toast({ title: text('toast.deleted') });
      if (this.isConnected) {
        navigate('/calculators', { replace: true });
      }
    } catch (error) {
      actionFailed(error, () => void this.removeCalculator(calculator));
    }
  }

  useView(calculator: Calculator): TemplateResult {
    const values = this.values.value;
    const results = evaluateCalculator(calculator, values);
    const seeded = calculator.provenance === 'catalog';
    return html`<div class="cl-calc-open">
      <header class="cl-calc-head">
        <h2 class="cl-calc-name">${calculator.name}</h2>
        ${
          seeded
            ? html`<lc-button variant="quiet" @click=${() => {
                this.mode.value = {
                  kind: 'edit',
                  id: null,
                  draft: { ...inputOf(calculator), name: text('calculators.copyName', { name: calculator.name }) },
                };
              }}>${text('calculators.makeCopy')}</lc-button>`
            : calculator.canEdit
              ? html`<lc-button variant="quiet" @click=${() => {
                  this.mode.value = { kind: 'edit', id: calculator.id, draft: inputOf(calculator) };
                }}>${text('calculators.edit')}</lc-button>`
              : nothing
        }
      </header>
      ${seeded ? html`<p class="cl-calc-muted">${text('calculators.seeded')}</p>` : nothing}
      ${calculator.description === '' ? nothing : html`<p class="cl-calc-description">${calculator.description}</p>`}
      <div class="cl-calc-inputs">
        ${calculator.inputs.map(
          (field) => html`<lc-input
            type="number"
            inputmode="decimal"
            label=${field.suffix === '' ? field.label : text('calculators.inputLabel', { label: field.label, suffix: field.suffix })}
            value=${values[field.key] === null || values[field.key] === undefined ? '' : String(values[field.key])}
            @input=${(event: Event) => {
              const raw = eventText(event).trim();
              const parsed = raw === '' ? null : Number(raw);
              this.values.value = {
                ...this.values.peek(),
                [field.key]: parsed !== null && Number.isFinite(parsed) ? parsed : null,
              };
            }}
          ></lc-input>`,
        )}
      </div>
      <dl class="cl-calc-results" aria-live="polite">
        ${results.map((result) => {
          const label = calculator.outputs.find((field) => field.key === result.key)?.label ?? result.key;
          return html`<div class="cl-calc-result">
            <dt>${label}</dt>
            <dd class="cl-num">${result.text}</dd>
            ${result.error === null ? nothing : html`<dd class="cl-calc-error">${result.error}</dd>`}
          </div>`;
        })}
      </dl>
      ${
        calculator.canEdit && !seeded
          ? html`<lc-button variant="ghost" @click=${() => void this.removeCalculator(calculator)}>
              <lc-icon name="trash-2" aria-hidden="true"></lc-icon>${text('calculators.delete')}
            </lc-button>`
          : nothing
      }
    </div>`;
  }

  editView(state: Extract<Mode, { kind: 'edit' }>): TemplateResult {
    const draft = state.draft;
    const issues = validateCalculator(draft);
    const inputNames = draft.inputs.map((field) => field.key).join(` ${text('calculators.and')} `);
    const blocked = issues.length > 0 || draft.name.trim() === '' || this.saving.value;
    const fields: FormField[] = [
      ...FIXED_FIELDS,
      { name: 'outputs', type: 'calculators-outputs', cmsType: 'calculators-outputs', inputNames },
    ];
    return html`<lc-form
      class="cl-calc-open"
      layout="stacked"
      .fields=${fields}
      .data=${{ name: draft.name, inputs: draft.inputs, outputs: draft.outputs }}
      .errors=${{ ...issueMessages(issues), ...this.serverErrors.value }}
      @field-change=${(event: Event) => {
        const values = formValues(event);
        if (values !== null) {
          this.serverErrors.value = {};
          this.edit((current) => draftFrom(values, current));
        }
      }}
      @form-submit=${() => {
        if (!blocked) {
          void this.save();
        }
      }}
    >
      <div class="cl-calc-footer">
        <lc-button variant="quiet" @click=${() => {
          this.mode.value = { kind: 'use' };
        }}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" type="submit" ?disabled=${blocked}>${text('calculators.save')}</lc-button>
      </div>
    </lc-form>`;
  }

  panel(calculators: readonly Calculator[]): TemplateResult {
    return html`<nav class="cl-calc-list" aria-label=${text('nav.calculators')}>
      ${calculators.map(
        (calculator) => html`<lc-list-row
          href=${`/calculators/${calculator.id}`}
          label=${calculator.name}
          hint=${calculator.provenance === 'catalog' ? text('calculators.fromCatalog') : ''}
          ?selected=${calculator.id === this.selectedId}
          chevron
        ></lc-list-row>`,
      )}
    </nav>`;
  }

  render() {
    const data = this.list.value.value;
    if (data === undefined) {
      return waiting(this.state, text('nav.calculators'), 'rows');
    }
    const mode = this.mode.value;
    const calculator = this.selected();
    const open =
      mode.kind === 'edit'
        ? this.editView(mode)
        : calculator !== null
          ? this.useView(calculator)
          : this.selectedId !== null
            ? html`<lc-empty-state title=${text('calculators.notFound')} description=${text('calculators.notFoundBody')}>
                ${illustration('empty-lost')}
              </lc-empty-state>`
            : nothing;
    return html`
      <header class="cl-calc-page-head">
        <h1 class="cl-calc-title">${text('nav.calculators')}</h1>
        <lc-button variant="primary" @click=${() => {
          this.mode.value = { kind: 'edit', id: null, draft: NEW_DRAFT() };
        }}>
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('calculators.new')}
        </lc-button>
      </header>
      <div class=${this.selectedId === null && mode.kind === 'use' ? 'cl-calc-grid is-list' : 'cl-calc-grid'}>
        ${this.panel(data.calculators)} ${open}
      </div>
    `;
  }
}
