import {
  type Calculator,
  type CalculatorInput,
  type CalculatorIssue,
  evaluateCalculator,
  LIMITS,
  validateCalculator,
} from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { eventText } from '../../../app/events.ts';
import { type LoadState, watch } from '../../../app/load.ts';
import { actionFailed } from '../../../app/problems.ts';
import { resourceFor } from '../../../app/resources.ts';
import { setScreenTitle } from '../../../app/router.ts';
import type { ScreenContext } from '../../../app/types.ts';
import { confirm } from '../../../design-system/dialogs.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { skeleton } from '../../../design-system/skeleton.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import './calc-view.css';

type Mode = { readonly kind: 'use' } | { readonly kind: 'edit'; readonly id: number | null; draft: CalculatorInput };

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

function issueAt(issues: readonly CalculatorIssue[], path: string): string {
  return issues.find((issue) => issue.path === path)?.error.message ?? '';
}

function fieldError(message: string): TemplateResult | typeof nothing {
  return message === '' ? nothing : html`<p class="cl-calc-error" role="alert">${message}</p>`;
}

export function calculatorScreen(ctx: ScreenContext, selectedId: number | null): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-calc-screen';
  const list = resourceFor('listCalculators', {});
  let mode: Mode = { kind: 'use' };
  let values: Record<string, number | null> = {};
  let shownId: number | null = null;
  let saving = false;
  let loadState: LoadState | null = null;

  const selected = (): Calculator | null => {
    const calculators = list.peek()?.calculators ?? [];
    return calculators.find((calculator) => calculator.id === selectedId) ?? null;
  };

  const edit = (patch: (draft: CalculatorInput) => CalculatorInput): void => {
    if (mode.kind === 'edit') {
      mode.draft = patch(mode.draft);
      draw();
    }
  };

  const save = async (): Promise<void> => {
    if (mode.kind !== 'edit') {
      return;
    }
    const { id, draft } = mode;
    saving = true;
    draw();
    try {
      const saved =
        id === null
          ? await call('createCalculator', { body: draft })
          : await call('replaceCalculator', { params: { id }, body: draft });
      await list.refresh();
      mode = { kind: 'use' };
      saving = false;
      toast({ title: text('calculators.saved') });
      if (saved.id === selectedId) {
        draw();
      } else {
        ctx.navigate(`/calculators/${saved.id}`);
      }
    } catch (error) {
      saving = false;
      draw();
      actionFailed(error, () => void save());
    }
  };

  const remove = async (calculator: Calculator): Promise<void> => {
    const sure = await confirm({
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
      await list.refresh();
      toast({ title: text('toast.deleted') });
      ctx.navigate('/calculators', { replace: true });
    } catch (error) {
      actionFailed(error, () => void remove(calculator));
    }
  };

  const useView = (calculator: Calculator): TemplateResult => {
    if (shownId !== calculator.id) {
      shownId = calculator.id;
      values = Object.fromEntries(calculator.inputs.map((field) => [field.key, field.defaultValue]));
    }
    const results = evaluateCalculator(calculator, values);
    const seeded = calculator.provenance === 'catalog';
    return html`<div class="cl-calc-open">
      <header class="cl-calc-head">
        <h2 class="cl-calc-name">${calculator.name}</h2>
        ${
          seeded
            ? html`<lc-button variant="quiet" @click=${() => {
                mode = {
                  kind: 'edit',
                  id: null,
                  draft: { ...inputOf(calculator), name: text('calculators.copyName', { name: calculator.name }) },
                };
                draw();
              }}>${text('calculators.makeCopy')}</lc-button>`
            : calculator.canEdit
              ? html`<lc-button variant="quiet" @click=${() => {
                  mode = { kind: 'edit', id: calculator.id, draft: inputOf(calculator) };
                  draw();
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
              values = { ...values, [field.key]: parsed !== null && Number.isFinite(parsed) ? parsed : null };
              draw();
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
          ? html`<lc-button variant="ghost" @click=${() => void remove(calculator)}>
              <lc-icon name="trash-2" aria-hidden="true"></lc-icon>${text('calculators.delete')}
            </lc-button>`
          : nothing
      }
    </div>`;
  };

  const editView = (state: Extract<Mode, { kind: 'edit' }>): TemplateResult => {
    const draft = state.draft;
    const issues = validateCalculator(draft);
    const inputNames = draft.inputs.map((field) => field.key).join(` ${text('calculators.and')} `);
    const blocked = issues.length > 0 || draft.name.trim() === '' || saving;
    return html`<form
      class="cl-calc-open"
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!blocked) {
          void save();
        }
      }}
    >
      <lc-input
        label=${text('calculators.name')}
        maxlength=${LIMITS.name.max}
        value=${draft.name}
        @input=${(event: Event) => edit((current) => ({ ...current, name: eventText(event) }))}
      ></lc-input>
      <fieldset class="cl-calc-group">
        <legend>${text('calculators.inputs')}</legend>
        ${draft.inputs.map(
          (field, index) => html`<div class="cl-calc-row">
            <lc-input
              label=${text('calculators.inputName', { position: index + 1 })}
              value=${field.key}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  inputs: current.inputs.map((item, at) => (at === index ? { ...item, key: eventText(event) } : item)),
                }))}
            ></lc-input>
            <lc-input
              label=${text('calculators.inputTitle', { position: index + 1 })}
              value=${field.label}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  inputs: current.inputs.map((item, at) =>
                    at === index ? { ...item, label: eventText(event) } : item,
                  ),
                }))}
            ></lc-input>
            <lc-input
              label=${text('calculators.inputDefault', { position: index + 1 })}
              type="number"
              value=${String(field.defaultValue)}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  inputs: current.inputs.map((item, at) =>
                    at === index ? { ...item, defaultValue: Number(eventText(event)) || 0 } : item,
                  ),
                }))}
            ></lc-input>
            <lc-input
              label=${text('calculators.inputUnit', { position: index + 1 })}
              maxlength=${LIMITS.calculatorSuffix.max}
              value=${field.suffix}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  inputs: current.inputs.map((item, at) =>
                    at === index ? { ...item, suffix: eventText(event) } : item,
                  ),
                }))}
            ></lc-input>
            ${fieldError(issueAt(issues, `inputs.${index}.key`))}
            <lc-button
              variant="ghost"
              ?disabled=${draft.inputs.length === 1}
              @click=${() => edit((current) => ({ ...current, inputs: current.inputs.filter((_, at) => at !== index) }))}
            >${text('calculators.removeInput', { position: index + 1 })}</lc-button>
          </div>`,
        )}
        <lc-button
          ?disabled=${draft.inputs.length >= LIMITS.calculatorInputs.max}
          @click=${() =>
            edit((current) => ({
              ...current,
              inputs: [
                ...current.inputs,
                { key: `input_${current.inputs.length + 1}`, label: '', defaultValue: 0, suffix: '' },
              ],
            }))}
        >${text('calculators.addInput')}</lc-button>
      </fieldset>
      <fieldset class="cl-calc-group">
        <legend>${text('calculators.results')}</legend>
        <p class="cl-calc-muted">${text('calculators.formulaHint', { inputs: inputNames })}</p>
        ${draft.outputs.map(
          (field, index) => html`<div class="cl-calc-row">
            <lc-input
              label=${text('calculators.resultLabel', { position: index + 1 })}
              value=${field.label}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  outputs: current.outputs.map((item, at) =>
                    at === index ? { ...item, label: eventText(event) } : item,
                  ),
                }))}
            ></lc-input>
            <lc-input
              label=${text('calculators.resultFormula', { position: index + 1 })}
              value=${field.expression}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  outputs: current.outputs.map((item, at) =>
                    at === index ? { ...item, expression: eventText(event) } : item,
                  ),
                }))}
            ></lc-input>
            <lc-input
              label=${text('calculators.resultUnit', { position: index + 1 })}
              maxlength=${LIMITS.calculatorSuffix.max}
              value=${field.suffix}
              @input=${(event: Event) =>
                edit((current) => ({
                  ...current,
                  outputs: current.outputs.map((item, at) =>
                    at === index ? { ...item, suffix: eventText(event) } : item,
                  ),
                }))}
            ></lc-input>
            ${fieldError(issueAt(issues, `outputs.${index}.expression`) || issueAt(issues, `outputs.${index}.key`))}
            <lc-button
              variant="ghost"
              ?disabled=${draft.outputs.length === 1}
              @click=${() => edit((current) => ({ ...current, outputs: current.outputs.filter((_, at) => at !== index) }))}
            >${text('calculators.removeResult', { position: index + 1 })}</lc-button>
          </div>`,
        )}
        <lc-button
          ?disabled=${draft.outputs.length >= LIMITS.calculatorOutputs.max}
          @click=${() =>
            edit((current) => ({
              ...current,
              outputs: [
                ...current.outputs,
                { key: `result_${current.outputs.length + 1}`, label: '', expression: '', decimals: 1, suffix: '' },
              ],
            }))}
        >${text('calculators.addResult')}</lc-button>
      </fieldset>
      <div class="cl-calc-footer">
        <lc-button variant="quiet" @click=${() => {
          mode = { kind: 'use' };
          draw();
        }}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" type="submit" ?disabled=${blocked}>${text('calculators.save')}</lc-button>
      </div>
    </form>`;
  };

  const panel = (calculators: readonly Calculator[]): TemplateResult => html`<nav
    class="cl-calc-list"
    aria-label=${text('nav.calculators')}
  >
    ${calculators.map(
      (calculator) => html`<lc-list-row
        href=${`/calculators/${calculator.id}`}
        label=${calculator.name}
        hint=${calculator.provenance === 'catalog' ? text('calculators.fromCatalog') : ''}
        ?selected=${calculator.id === selectedId}
        chevron
      ></lc-list-row>`,
    )}
  </nav>`;

  const draw = (): void => {
    const data = list.peek();
    const problem = loadState?.error(list) ?? null;
    if (data === undefined) {
      if (problem !== null) {
        render(
          html`<lc-empty-state title=${text('loadFailed.title', { screen: text('nav.calculators') })} description=${text('loadFailed.body')}>
            ${illustration('empty-lost')}
            <lc-button variant="primary" @click=${() => loadState?.retry()}>${text('loadFailed.retry')}</lc-button>
          </lc-empty-state>`,
          element,
        );
      } else if (loadState?.slow === true && element.querySelector('.cl-skeleton') === null) {
        element.replaceChildren(skeleton('rows', text('nav.calculators')));
      }
      return;
    }
    element.querySelector('.cl-skeleton')?.remove();
    const calculator = selected();
    if (calculator !== null) {
      setScreenTitle(calculator.name);
    }
    const open =
      mode.kind === 'edit'
        ? editView(mode)
        : calculator !== null
          ? useView(calculator)
          : selectedId !== null
            ? html`<lc-empty-state title=${text('calculators.notFound')} description=${text('calculators.notFoundBody')}>
                ${illustration('empty-lost')}
              </lc-empty-state>`
            : nothing;
    render(
      html`
        <header class="cl-calc-page-head">
          <h1 class="cl-calc-title">${text('nav.calculators')}</h1>
          <lc-button variant="primary" @click=${() => {
            mode = { kind: 'edit', id: null, draft: NEW_DRAFT() };
            draw();
          }}>
            <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('calculators.new')}
          </lc-button>
        </header>
        <div class=${selectedId === null && mode.kind === 'use' ? 'cl-calc-grid is-list' : 'cl-calc-grid'}>
          ${panel(data.calculators)} ${open}
        </div>
      `,
      element,
    );
  };

  watch(element, [list], (state) => {
    loadState = state;
    draw();
  });
  return element;
}
