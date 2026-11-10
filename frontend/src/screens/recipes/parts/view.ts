import { html, type TemplateResult } from '@lightstart/light/html';
import { eventField } from '../../../app/events.ts';
import { href } from '../../../app/router.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/empty-state.ts';

export function triggerOf(event: Event, fallback: Element): Element {
  const trigger = eventField(event, 'trigger');
  if (trigger instanceof Element) {
    return trigger;
  }
  return event.currentTarget instanceof Element ? event.currentTarget : fallback;
}

export function notFound(bookSize: number | null = null): TemplateResult {
  return html`<lc-empty-state
    title=${text('recipes.notFoundTitle')}
    description=${bookSize === null ? text('recipes.notFoundBody') : text(bookSize === 1 ? 'recipes.notFoundCountOne' : 'recipes.notFoundCount', { count: bookSize })}
  >
    ${illustration('empty-lost')}
    <lc-button variant="primary" href=${href('/recipes')}>${text('recipes.backToRecipes')}</lc-button>
  </lc-empty-state>`;
}
