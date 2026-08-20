import { createHash } from 'node:crypto';

/**
 * Normalise a phone number to its significant digits so that
 * "(555) 010-1234", "555-010-1234" and "+1 555 010 1234" all hash alike.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/\D+/g, '');
  if (!digits) return null;
  // Strip a NANP country code so domestic and E.164 forms collide.
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length < 7) return null;
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

export function hashPhone(raw: unknown): string | null {
  const normalized = normalizePhone(raw);
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
