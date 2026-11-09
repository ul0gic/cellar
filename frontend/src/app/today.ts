import type { IsoDate } from '@cellar/contract';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function today(): IsoDate {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
