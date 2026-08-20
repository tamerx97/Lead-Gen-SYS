import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function money(value: number | string | null | undefined, compact = false): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '$0.00';
  return compact && Math.abs(n) >= 10_000 ? compactCurrency.format(n) : currency.format(n);
}

export function percent(value: number | null | undefined, digits = 1): string {
  const n = Number(value ?? 0);
  return `${(Number.isFinite(n) ? n * 100 : 0).toFixed(digits)}%`;
}

export function number(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(Number(value ?? 0));
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const diffSeconds = Math.round((d.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];
  let value2 = diffSeconds;
  for (const [unit, limit] of units) {
    if (Math.abs(value2) < limit) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
        Math.round(value2),
        unit
      );
    }
    value2 /= limit;
  }
  return '—';
}

/** Turn `1_3_months` into `1 3 months` for display without losing the raw value. */
export function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];
