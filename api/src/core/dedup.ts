import { createHash } from 'node:crypto';

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Region used to interpret phone numbers written in national format. */
export const DEFAULT_PHONE_REGION = 'US';

/** Shorter than this and we refuse to treat the value as an identity at all. */
const MIN_NATIONAL_DIGITS = 7;

/**
 * Normalise a phone number to its E.164 digits so that every way of writing the
 * same number hashes alike.
 *
 * `defaultRegion` only matters for numbers written in *national* format
 * ("020 7946 0958"); anything already in international format ("+44 …") is
 * understood regardless of the setting.
 *
 * Note we deliberately accept a number that parses but fails `isValid()`.
 * Reserved test ranges (555-01xx in the US) are invalid by definition, and
 * refusing them would make the system undeduplicatable in staging while
 * silently changing behaviour in production.
 */
export function normalizePhone(
  raw: unknown,
  defaultRegion: string = DEFAULT_PHONE_REGION
): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const parsed = parsePhoneNumberFromString(value, defaultRegion as CountryCode);
  // libphonenumber will happily turn "12345" into "+112345". Require a
  // plausible national number so short junk doesn't become a hashable identity
  // that could collide two unrelated leads.
  if (parsed?.number && parsed.nationalNumber.length >= MIN_NATIONAL_DIGITS) {
    return parsed.number.replace(/^\+/, '');
  }

  // Unparseable (wrong length, junk region, extensions we don't understand):
  // fall back to a digits-only form so two identical malformed strings still
  // collide rather than every one of them becoming a fresh "unique" lead.
  let digits = value.replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length < MIN_NATIONAL_DIGITS) return null;
  return digits;
}

export function normalizeEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || !value.includes('@')) return null;
  return value;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPhone(
  raw: unknown,
  defaultRegion: string = DEFAULT_PHONE_REGION
): string | null {
  const normalized = normalizePhone(raw, defaultRegion);
  return normalized ? sha256(`phone:${normalized}`) : null;
}

export function hashEmail(raw: unknown): string | null {
  const normalized = normalizeEmail(raw);
  return normalized ? sha256(`email:${normalized}`) : null;
}

/** Start of the dedup lookback window, or null when dedup is disabled. */
export function dedupWindowStart(now: Date, windowDays: number): Date | null {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return null;
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
}

export interface DedupCandidate {
  phoneHash: string | null;
  emailHash: string | null;
}

/**
 * A lead is a duplicate when either identifier matches a prior sale in the same
 * vertical inside the window. Callers supply the prior hashes; the DB query
 * lives in `services/post.ts`.
 */
export function isDuplicate(
  candidate: DedupCandidate,
  priorPhoneHashes: Set<string>,
  priorEmailHashes: Set<string>
): { duplicate: boolean; on?: 'phone' | 'email' } {
  if (candidate.phoneHash && priorPhoneHashes.has(candidate.phoneHash)) {
    return { duplicate: true, on: 'phone' };
  }
  if (candidate.emailHash && priorEmailHashes.has(candidate.emailHash)) {
    return { duplicate: true, on: 'email' };
  }
  return { duplicate: false };
}
