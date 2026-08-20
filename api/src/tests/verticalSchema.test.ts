import { describe, expect, it } from 'vitest';
import {
  parseFieldSchema,
  stripPii,
  validateAgainstFieldSchema,
  verticalFieldSchemaArray,
} from '../core/verticalSchema';
import type { VerticalField } from '../core/types';

const fields: VerticalField[] = [
  { name: 'homeowner', label: 'Homeowner', type: 'boolean', required: true },
  { name: 'property_age', label: 'Property Age', type: 'number', required: false },
  {
    name: 'timeline',
    label: 'Timeline',
    type: 'enum',
    required: true,
    options: ['immediately', '1_3_months', 'researching'],
  },
  { name: 'notes', label: 'Notes', type: 'text', required: false },
];

describe('validateAgainstFieldSchema', () => {
  it('coerces the string forms that arrive over HTTP', () => {
    const r = validateAgainstFieldSchema(fields, {
      homeowner: 'true',
      property_age: '30',
      timeline: 'IMMEDIATELY',
      notes: 42,
    });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({
      homeowner: true,
      property_age: 30,
      timeline: 'immediately',
      notes: '42',
    });
  });

  it('reports missing required fields', () => {
    const r = validateAgainstFieldSchema(fields, { property_age: 10 });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.field).sort()).toEqual(['homeowner', 'timeline']);
  });

  it('rejects an enum value outside the configured options', () => {
    const r = validateAgainstFieldSchema(fields, { homeowner: true, timeline: 'someday' });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('must be one of');
  });

  it('rejects a non-numeric number', () => {
    const r = validateAgainstFieldSchema(fields, {
      homeowner: true,
      timeline: 'researching',
      property_age: 'old',
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0].field).toBe('property_age');
  });

  it('passes through unknown attributes but drops transport keys', () => {
    const r = validateAgainstFieldSchema(fields, {
      homeowner: true,
      timeline: 'researching',
      extra_context: 'keep-me',
      vertical: 'home_improvement',
      ping_id: 'abc',
    });
    expect(r.values.extra_context).toBe('keep-me');
    expect(r.values.vertical).toBeUndefined();
    expect(r.values.ping_id).toBeUndefined();
  });

  it('an empty schema accepts anything', () => {
    expect(validateAgainstFieldSchema([], { whatever: 1 }).ok).toBe(true);
  });
});

describe('verticalFieldSchemaArray', () => {
  it('requires options on enum fields', () => {
    const r = verticalFieldSchemaArray.safeParse([
      { name: 'x', label: 'X', type: 'enum', required: false },
    ]);
    expect(r.success).toBe(false);
  });

  it('rejects duplicate and reserved field names', () => {
    expect(
      verticalFieldSchemaArray.safeParse([
        { name: 'a', label: 'A', type: 'text', required: false },
        { name: 'a', label: 'A2', type: 'text', required: false },
      ]).success
    ).toBe(false);
    expect(
      verticalFieldSchemaArray.safeParse([
        { name: 'state', label: 'State', type: 'text', required: false },
      ]).success
    ).toBe(false);
  });

  it('rejects field names that are not identifier-like', () => {
    expect(
      verticalFieldSchemaArray.safeParse([
        { name: '2bad', label: 'Bad', type: 'text', required: false },
      ]).success
    ).toBe(false);
  });

  it('accepts a well-formed schema', () => {
    expect(verticalFieldSchemaArray.safeParse(fields).success).toBe(true);
  });
});

describe('parseFieldSchema', () => {
  it('reads JSON strings and rejects malformed input', () => {
    expect(parseFieldSchema(JSON.stringify(fields))).toHaveLength(4);
    expect(parseFieldSchema('garbage')).toEqual([]);
    expect(parseFieldSchema({ not: 'an array' })).toEqual([]);
  });
});

describe('stripPii', () => {
  it('drops PII keys from a ping payload but keeps qualifying attributes', () => {
    const out = stripPii({
      state: 'CA',
      zip: '90210',
      homeowner: true,
      first_name: 'Jane',
      phone: '5550101234',
      email: 'jane@example.com',
      address: '1 Main St',
    });
    expect(out).toEqual({ state: 'CA', zip: '90210', homeowner: true });
  });
});
