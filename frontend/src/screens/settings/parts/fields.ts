import { html, type TemplateResult } from '@lightstart/light/html';
import { eventChecked, eventValue } from './events.ts';

export function switchField(
  label: string,
  description: string,
  checked: boolean,
  change: (checked: boolean, revert: () => void) => void,
  disabled = false,
): TemplateResult {
  return html`<div class="cl-switch-field">
    <lc-switch
      label=${label}
      hint=${description}
      ?checked=${checked}
      ?disabled=${disabled}
      @change=${(event: Event) => {
        const control = event.currentTarget;
        change(eventChecked(event), () => {
          if (control instanceof HTMLElement && 'checked' in control) {
            control.checked = checked;
          }
        });
      }}
    ></lc-switch>
  </div>`;
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export function segmentedField(
  label: string,
  options: readonly Choice[],
  value: string,
  change: (value: string) => void,
): TemplateResult {
  return html`<div class="cl-field">
    <span class="cl-field-label">${label}</span>
    <lc-segmented
      label=${label}
      .options=${options.map((option) => ({ value: option.value, label: option.label }))}
      value=${value}
      @change=${(event: Event) => change(eventValue(event))}
    ></lc-segmented>
  </div>`;
}
