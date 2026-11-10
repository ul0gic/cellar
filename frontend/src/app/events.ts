export function eventDetail(event: Event): unknown {
  return event instanceof CustomEvent ? event.detail : undefined;
}

export function eventField(event: Event, key: string): unknown {
  const detail = eventDetail(event);
  return typeof detail === 'object' && detail !== null && key in detail ? Reflect.get(detail, key) : undefined;
}

export function eventText(event: Event): string {
  const value = eventField(event, 'value');
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
}

export function detailText(event: Event): string {
  const detail = eventDetail(event);
  return typeof detail === 'string' ? detail : '';
}

export function eventNumber(event: Event): number | null {
  const value = eventField(event, 'value');
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

export function eventChecked(event: Event): boolean {
  return eventField(event, 'checked') === true;
}

export function eventPage(event: Event): number | null {
  const page = eventField(event, 'page');
  return typeof page === 'number' ? page : null;
}

export function eventFile(event: Event): File | null {
  const files = eventField(event, 'files');
  const first: unknown = Array.isArray(files) ? files[0] : undefined;
  return first instanceof File ? first : null;
}

export function droppedFile(event: Event): File | null {
  const value = eventField(event, 'value');
  return value instanceof File ? value : null;
}

export function eventPick(event: Event): { readonly id: number; readonly title: string } {
  const id = eventField(event, 'id');
  const title = eventField(event, 'title');
  if (typeof id !== 'number' || typeof title !== 'string') {
    throw new TypeError(`The ${event.type} event carries no picked row`);
  }
  return { id, title };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function formValues(event: Event): Record<string, unknown> | null {
  const values = eventField(event, 'values');
  return isRecord(values) ? values : null;
}

export function valueText(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  return typeof value === 'string' ? value : '';
}
