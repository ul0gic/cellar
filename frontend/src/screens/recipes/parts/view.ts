import { eventField } from '../../../app/events.ts';

export function triggerOf(event: Event, fallback: Element): Element {
  const trigger = eventField(event, 'trigger');
  if (trigger instanceof Element) {
    return trigger;
  }
  return event.currentTarget instanceof Element ? event.currentTarget : fallback;
}
