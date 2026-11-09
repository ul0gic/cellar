export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}

export function detailOf(event: Event): unknown {
  if (!(event instanceof CustomEvent)) {
    return undefined;
  }
  const detail: unknown = event.detail;
  return detail;
}

export function detailField(event: Event, key: string): unknown {
  const detail = detailOf(event);
  return typeof detail === 'object' && detail !== null && key in detail ? Reflect.get(detail, key) : undefined;
}

export function droppedFile(event: Event): File | null {
  const value = detailField(event, 'value');
  return value instanceof File ? value : null;
}
