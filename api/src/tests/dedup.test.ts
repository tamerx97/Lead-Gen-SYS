import { describe, expect, it } from 'vitest';
import {
  dedupWindowStart,
  hashEmail,
  hashPhone,
  isDuplicate,
  normalizeEmail,
  normalizePhone,
} from '../core/dedup';

describe('normalizePhone', () => {
  it('collapses formatting differences to the same digits', () => {
    const forms = ['(555) 010-1234', '555-010-1234', '555.010.1234', '+1 555 010 1234', '15550101234'];
    const normalized = forms.map(normalizePhone);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('5550101234');
  });

  it('rejects values that are too short to be a phone number', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
  });
  it('rejects non-addresses', () => {
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('hashing', () => {
  it('is stable, 64-hex, and domain-separated between phone and email', () => {
    const h = hashPhone('555-010-1234');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhone('+1 (555) 010 1234')).toBe(h);
    expect(hashPhone('555-010-9999')).not.toBe(h);
    // The same literal string hashed as a phone and as an email must differ.
    expect(hashEmail('a@b.com')).not.toBe(hashPhone('a@b.com'));
  });

  it('returns null rather than hashing junk', () => {
    expect(hashPhone('x')).toBeNull();
    expect(hashEmail('x')).toBeNull();
  });
});

describe('isDuplicate', () => {
  const phone = hashPhone('555-010-1234')!;
  const email = hashEmail('jane@example.com')!;

  it('flags a phone match', () => {
    expect(isDuplicate({ phoneHash: phone, emailHash: null }, new Set([phone]), new Set())).toEqual({
      duplicate: true,
      on: 'phone',
    });
  });

  it('flags an email match', () => {
    expect(isDuplicate({ phoneHash: null, emailHash: email }, new Set(), new Set([email]))).toEqual({
      duplicate: true,
      on: 'email',
    });
  });

  it('passes a lead that matches neither', () => {
    expect(
      isDuplicate({ phoneHash: phone, emailHash: email }, new Set(['other']), new Set(['other']))
    ).toEqual({ duplicate: false });
  });

  it('never flags a lead with no identifiers at all', () => {
    expect(isDuplicate({ phoneHash: null, emailHash: null }, new Set(['a']), new Set(['b']))).toEqual(
      { duplicate: false }
    );
  });
});

describe('dedupWindowStart', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('returns the window start for a positive window', () => {
    expect(dedupWindowStart(now, 30)?.toISOString()).toBe('2026-07-21T12:00:00.000Z');
  });

  it('returns null when dedup is disabled', () => {
    expect(dedupWindowStart(now, 0)).toBeNull();
    expect(dedupWindowStart(now, -1)).toBeNull();
    expect(dedupWindowStart(now, NaN)).toBeNull();
  });
});
