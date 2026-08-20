import { describe, expect, it } from 'vitest';
import { evaluateRule, evaluateRules, parseFilters } from '../core/filters';
import type { FilterRule } from '../core/types';

const attrs = {
  state: 'CA',
  zip: '90210',
  homeowner: true,
  property_age: 25,
  timeline: 'immediately',
  current_insurer: 'Acme Mutual',
};

describe('evaluateRule', () => {
  it('eq matches across string/number/boolean representations', () => {
    expect(evaluateRule({ field: 'property_age', op: 'eq', value: 25 }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'property_age', op: 'eq', value: '25' }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'homeowner', op: 'eq', value: 'true' }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'homeowner', op: 'eq', value: false }, attrs)).toBe(false);
    expect(evaluateRule({ field: 'timeline', op: 'eq', value: 'IMMEDIATELY' }, attrs)).toBe(true);
  });

  it('ne is the inverse of eq, and passes when the attribute is absent', () => {
    expect(evaluateRule({ field: 'timeline', op: 'ne', value: 'researching' }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'timeline', op: 'ne', value: 'immediately' }, attrs)).toBe(false);
    expect(evaluateRule({ field: 'missing', op: 'ne', value: 'x' }, attrs)).toBe(true);
  });

  it('compares numerically for gt/gte/lt/lte', () => {
    expect(evaluateRule({ field: 'property_age', op: 'gt', value: 10 }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'property_age', op: 'gt', value: 25 }, attrs)).toBe(false);
    expect(evaluateRule({ field: 'property_age', op: 'gte', value: 25 }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'property_age', op: 'lt', value: 30 }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'property_age', op: 'lte', value: 25 }, attrs)).toBe(true);
    // "9" vs 25 must not be compared as strings.
    expect(evaluateRule({ field: 'property_age', op: 'gt', value: '9' }, attrs)).toBe(true);
  });

  it('in accepts arrays and comma-separated strings', () => {
    expect(
      evaluateRule({ field: 'timeline', op: 'in', value: ['immediately', '1_3_months'] }, attrs)
    ).toBe(true);
    expect(evaluateRule({ field: 'timeline', op: 'in', value: 'researching, someday' }, attrs)).toBe(
      false
    );
    expect(evaluateRule({ field: 'state', op: 'in', value: 'CA,TX,NY' }, attrs)).toBe(true);
  });

  it('contains does a case-insensitive substring test', () => {
    expect(evaluateRule({ field: 'current_insurer', op: 'contains', value: 'acme' }, attrs)).toBe(
      true
    );
    expect(evaluateRule({ field: 'current_insurer', op: 'contains', value: 'zzz' }, attrs)).toBe(
      false
    );
  });

  it('exists checks presence, and inverts on value:false', () => {
    expect(evaluateRule({ field: 'homeowner', op: 'exists' }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'missing', op: 'exists' }, attrs)).toBe(false);
    expect(evaluateRule({ field: 'missing', op: 'exists', value: false }, attrs)).toBe(true);
    expect(evaluateRule({ field: 'homeowner', op: 'exists', value: false }, attrs)).toBe(false);
  });

  it('fails closed when the attribute is missing', () => {
    for (const op of ['eq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const) {
      expect(evaluateRule({ field: 'nope', op, value: 1 }, attrs)).toBe(false);
    }
  });

  it('fails closed on an unknown operator', () => {
    expect(evaluateRule({ field: 'state', op: 'regex' as never, value: 'CA' }, attrs)).toBe(false);
  });
});

describe('evaluateRules', () => {
  it('ANDs every rule and reports the first failure', () => {
    const rules: FilterRule[] = [
      { field: 'homeowner', op: 'eq', value: true },
      { field: 'property_age', op: 'gte', value: 15 },
    ];
    expect(evaluateRules(rules, attrs)).toEqual({ passed: true });

    const failing: FilterRule[] = [
      { field: 'homeowner', op: 'eq', value: true },
      { field: 'property_age', op: 'gte', value: 40 },
      { field: 'timeline', op: 'eq', value: 'never' },
    ];
    const result = evaluateRules(failing, attrs);
    expect(result.passed).toBe(false);
    expect(result.passed === false && result.rule.field).toBe('property_age');
  });

  it('an empty rule set accepts everything', () => {
    expect(evaluateRules([], {}).passed).toBe(true);
  });
});

describe('parseFilters', () => {
  it('handles JSON strings, arrays, and garbage', () => {
    expect(parseFilters('[{"field":"a","op":"eq","value":1}]')).toHaveLength(1);
    expect(parseFilters([{ field: 'a', op: 'eq', value: 1 }])).toHaveLength(1);
    expect(parseFilters(null)).toEqual([]);
    expect(parseFilters('not json')).toEqual([]);
    expect(parseFilters([{ field: 'a', op: 'bogus' }])).toEqual([]);
  });
});
