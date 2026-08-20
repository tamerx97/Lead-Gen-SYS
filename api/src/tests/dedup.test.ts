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
  it('collapses every US formatting variant onto one E.164 value', () => {
    const forms = [
      '(555) 010-1234',
      '555-010-1234',
      '555.010.1234',
      '+1 555 010 1234',
      '15550101234',
      ' 555 010 1234 ',
    ];
    const normalized = forms.map((f) => normalizePhone(f));
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('15550101234');
  });

  it('normalises a reserved test range that is parseable but not "valid"', () => {
    // 555-01xx numbers fail libphonenumber's isValid(); we still normalise them,
    // otherwise dedup would silently stop working in staging.
    expect(normalizePhone('555-010-1234')).toBe('15550101234');
  });

  it('understands international numbers written in national format', () => {
    // The regression this replaces: a UK number written nationally and the same
    // number in E.164 used to hash differently.
    expect(normalizePhone('020 7946 0958', 'GB')).toBe('442079460958');
    expect(normalizePhone('+44 20 7946 0958', 'GB')).toBe('442079460958');
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958');
    expect(normalizePhone('020 7946 0958', 'GB')).toBe(normalizePhone('+44 20 7946 0958', 'US'));
  });

  it('reads a national-format number using the configured default region', () => {
    // The same digits mean different numbers in different countries, which is
    // exactly why the region is a setting rather than a constant.
    expect(normalizePhone('030 12345678', 'DE')).toBe('493012345678');
    expect(normalizePhone('02 9374 4000', 'AU')).toBe('61293744000');
  });

  it('does not collide two different countries that share national digits', () => {
    const gb = normalizePhone('020 7946 0958', 'GB');
    const de = normalizePhone('020 7946 0958', 'DE');
    expect(gb).not.toBe(de);
  });

  it('falls back to a digits-only form for values it cannot parse', () => {
    // Identical junk must still collide rather than minting a new lead each time.
    const a = normalizePhone('5550172465359999');
    const b = normalizePhone('555-0172-4653-5999-9');
    expect(a).toBe(b);
    expect(a).not.toBeNull();
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

describe('hashPhone regions', () => {
  it('hashes the same real-world number identically across input formats', () => {
    expect(hashPhone('020 7946 0958', 'GB')).toBe(hashPhone('+442079460958', 'GB'));
    // A caller in another region still recognises the E.164 form.
    expect(hashPhone('+44 20 7946 0958', 'US')).toBe(hashPhone('020 7946 0958', 'GB'));
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
