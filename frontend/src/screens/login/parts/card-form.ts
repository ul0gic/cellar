import { registerFormFieldRenderer } from '@lightstart/components/form/field-renderers.js';
import type { FormField } from '@lightstart/components/types.js';

export const INTRO_TYPE = 'login-intro';

registerFormFieldRenderer(INTRO_TYPE, (field, _value, _onChange, template) => {
  const { heading, lead } = field;
  return template`<h1>${typeof heading === 'string' ? heading : ''}</h1>
    <p class="cl-card-lead">${typeof lead === 'string' ? lead : ''}</p>`;
});

export function introField(heading: string, lead: string): FormField {
  return { name: 'intro', type: INTRO_TYPE, cmsType: INTRO_TYPE, class: 'cl-card-intro', heading, lead };
}
