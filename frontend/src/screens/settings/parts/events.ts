function detailOf(event: Event): object {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  if (typeof detail !== 'object' || detail === null) {
    throw new TypeError(`The ${event.type} event carries no detail`);
  }
  return detail;
}

export function eventValue(event: Event): string {
  const detail = detailOf(event);
  if (!('value' in detail) || typeof detail.value !== 'string') {
    throw new TypeError(`The ${event.type} event carries no text value`);
  }
  return detail.value;
}

export function eventChecked(event: Event): boolean {
  const detail = detailOf(event);
  if (!('checked' in detail) || typeof detail.checked !== 'boolean') {
    throw new TypeError(`The ${event.type} event carries no checked state`);
  }
  return detail.checked;
}

export function eventFile(event: Event): File | null {
  const detail = detailOf(event);
  if (!('files' in detail) || !Array.isArray(detail.files)) {
    throw new TypeError(`The ${event.type} event carries no files`);
  }
  const first: unknown = detail.files[0];
  return first instanceof File ? first : null;
}

export function eventText(event: Event): string {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  if (typeof detail !== 'string') {
    throw new TypeError(`The ${event.type} event carries no text`);
  }
  return detail;
}

export function eventPick(event: Event): { readonly id: number; readonly title: string } {
  const detail = detailOf(event);
  if (!('id' in detail) || typeof detail.id !== 'number' || !('title' in detail) || typeof detail.title !== 'string') {
    throw new TypeError(`The ${event.type} event carries no picked row`);
  }
  return { id: detail.id, title: detail.title };
}
