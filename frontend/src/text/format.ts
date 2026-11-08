import { currencyDigits, type IsoDate, type IsoDateTime } from '@cellar/contract';

const LOCALE = 'en-US';

const numberFormat = new Intl.NumberFormat(LOCALE);
const listDate = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
const thisYearDate = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });

export type DateStyle = 'list' | 'this-year' | 'long';

function toDate(value: IsoDate | IsoDateTime): Date {
  return value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
}

export function formatDate(value: IsoDate | IsoDateTime, style: DateStyle = 'list'): string {
  const date = toDate(value);
  switch (style) {
    case 'list':
      return listDate.format(date);
    case 'this-year':
      return date.getFullYear() === new Date().getFullYear() ? thisYearDate.format(date) : listDate.format(date);
    case 'long':
      return longDate.format(date);
  }
}

export function formatTime(value: IsoDateTime): string {
  return timeFormat.format(new Date(value)).replace('AM', 'am').replace('PM', 'pm');
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatCount(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function formatWholeMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    minor / 10 ** currencyDigits(currency),
  );
}
