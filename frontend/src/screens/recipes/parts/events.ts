function detailOf(event: Event): object | null {
  return event instanceof CustomEvent && typeof event.detail === 'object' && event.detail !== null
    ? event.detail
    : null;
}

export function eventText(event: Event): string {
  const detail = detailOf(event);
  if (detail !== null && 'value' in detail && typeof detail.value === 'string') {
    return detail.value;
  }
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target.value : '';
}

export function eventNumber(event: Event): number | null {
  const detail = detailOf(event);
  if (detail === null || !('value' in detail)) {
    return null;
  }
  const value = typeof detail.value === 'string' ? Number(detail.value) : detail.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function eventChecked(event: Event): boolean {
  const detail = detailOf(event);
  return detail !== null && 'checked' in detail && detail.checked === true;
}
