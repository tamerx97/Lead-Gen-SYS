import type { FilterOp, FilterRule, PingAttributes } from './types';

export const FILTER_OPS: FilterOp[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'exists',
];

/**
 * Loose scalar comparison. Lead attributes arrive over HTTP, so "3" and 3 and
 * "TRUE" and true must be treated as equal to the values an operator typed into
 * the campaign filter builder.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;

  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an === bn;

  const ab = toBoolean(a);
  const bb = toBoolean(b);
  if (ab !== null && bb !== null) return ab === bb;

  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(v)) return true;
    if (['false', 'no', 'n', '0'].includes(v)) return false;
  }
  return null;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** Compare two values numerically when both look numeric, else lexically. */
function compare(a: unknown, b: unknown): number | null {
  const an = toNumber(a);
  const bn = toNumber(b);
  if (an !== null && bn !== null) return an === bn ? 0 : an < bn ? -1 : 1;
  if (!isPresent(a) || !isPresent(b)) return null;
  const as = String(a).trim().toLowerCase();
  const bs = String(b).trim().toLowerCase();
  return as === bs ? 0 : as < bs ? -1 : 1;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  if (value === null || value === undefined) return [];
  return [value];
}

/**
 * Evaluate a single rule against the ping attributes.
 *
 * A missing attribute fails every operator except `ne` and a negative `exists`
 * check — a campaign that demands `homeowner = true` must not win a ping that
 * never mentioned `homeowner`.
 */
export function evaluateRule(rule: FilterRule, attrs: PingAttributes): boolean {
  const actual = attrs[rule.field];

  switch (rule.op) {
    case 'exists': {
      // `value: false` inverts the check.
      const want = toBoolean(rule.value);
      const wantPresent = want === null ? true : want;
      return isPresent(actual) === wantPresent;
    }
    case 'ne':
      // Absent means "not equal to whatever was asked for".
      return !isPresent(actual) ? true : !looseEquals(actual, rule.value);
    case 'eq':
      return isPresent(actual) && looseEquals(actual, rule.value);
    case 'in': {
      if (!isPresent(actual)) return false;
      return toArray(rule.value).some((candidate) => looseEquals(actual, candidate));
    }
    case 'contains': {
      if (!isPresent(actual)) return false;
      return String(actual).toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (!isPresent(actual)) return false;
      const cmp = compare(actual, rule.value);
      if (cmp === null) return false;
      if (rule.op === 'gt') return cmp > 0;
      if (rule.op === 'gte') return cmp >= 0;
      if (rule.op === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    default:
      // Unknown operator: fail closed rather than silently selling the lead.
      return false;
  }
}

/**
 * All rules must pass (AND). Returns the first failing rule so the caller can
 * report `filter:<field>` back to the source.
 */
export function evaluateRules(
  rules: FilterRule[],
  attrs: PingAttributes
): { passed: true } | { passed: false; rule: FilterRule } {
  for (const rule of rules) {
    if (!evaluateRule(rule, attrs)) return { passed: false, rule };
  }
  return { passed: true };
}

/** Tolerates a `filters` column that is null, a JSON string, or malformed. */
export function parseFilters(raw: unknown): FilterRule[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is FilterRule =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as FilterRule).field === 'string' &&
      FILTER_OPS.includes((r as FilterRule).op)
  );
}
