import type { Buyer } from '@prisma/client';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Generic outbound delivery.
 *
 * The platform deliberately ships no vendor-specific integrations. A buyer is
 * any HTTP endpoint: you configure the URL, the body format, the headers, and
 * optionally a field mapping to reshape the payload into whatever names that
 * endpoint expects. That is the whole integration surface.
 */

export type DeliveryOutcome = 'delivered' | 'failed' | 'skipped';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  attempts: number;
  status?: number;
  ok?: boolean;
  body?: string;
  error?: string;
  url?: string;
  method?: string;
  requestBody?: string;
  contentType?: string;
  durationMs?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlTagName(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function toXml(payload: Record<string, unknown>, root = 'lead'): string {
  const body = Object.entries(payload)
    .map(([key, value]) => {
      const tag = xmlTagName(key);
      const text =
        value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
      return `  <${tag}>${escapeXml(text)}</${tag}>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root}>\n${body}\n</${root}>`;
}

function toFormEncoded(payload: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return params.toString();
}

/** Read `a.b.c` out of a nested object. */
function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[segment];
    return undefined;
  }, source);
}

export function parseFieldMapping(raw: unknown): Record<string, string> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function parseHeaders(raw: unknown): Record<string, string> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  return out;
}

/**
 * Apply a buyer's optional `fieldMapping`.
 *
 * `{ "FirstName": "first_name", "Zip": "zip" }` renames those keys; keys absent
 * from the mapping are dropped, so a mapping doubles as an allow-list. An empty
 * mapping sends the document as-is.
 */
export function applyFieldMapping(
  payload: Record<string, unknown>,
  mapping: Record<string, string>
): Record<string, unknown> {
  if (Object.keys(mapping).length === 0) return payload;
  const out: Record<string, unknown> = {};
  for (const [outgoingKey, sourcePath] of Object.entries(mapping)) {
    const value = readPath(payload, sourcePath);
    if (value !== undefined) out[outgoingKey] = value;
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DeliverOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

/**
 * POST the lead to the buyer's endpoint, retrying transient failures with
 * exponential backoff. 4xx responses are treated as permanent (a rejected lead
 * won't be accepted by retrying) except 408 and 429.
 */
export async function deliverLead(
  buyer: Pick<Buyer, 'deliveryUrl' | 'deliveryMethod' | 'deliveryHeaders' | 'fieldMapping'>,
  document: Record<string, unknown>,
  options: DeliverOptions = {}
): Promise<DeliveryResult> {
  const url = buyer.deliveryUrl?.trim();
  if (!url) {
    // No endpoint configured: the lead is sold and waits for manual pickup.
    return { outcome: 'skipped', attempts: 0, error: 'Buyer has no deliveryUrl configured' };
  }

  const maxAttempts = options.maxAttempts ?? env.DELIVERY_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? env.DELIVERY_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? env.DELIVERY_BACKOFF_MS;

  const mapped = applyFieldMapping(document, parseFieldMapping(buyer.fieldMapping));
  const method = buyer.deliveryMethod ?? 'json';

  let body: string;
  let contentType: string;
  if (method === 'form') {
    body = toFormEncoded(mapped);
    contentType = 'application/x-www-form-urlencoded';
  } else if (method === 'xml') {
    body = toXml(mapped);
    contentType = 'application/xml';
  } else {
    body = JSON.stringify(mapped);
    contentType = 'application/json';
  }

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    Accept: '*/*',
    'User-Agent': 'LeadGenSYS/1.0',
    ...parseHeaders(buyer.deliveryHeaders),
  };

  let attempts = 0;
  let lastError = '';
  let lastStatus: number | undefined;
  let lastBody: string | undefined;
  const started = Date.now();

  while (attempts < maxAttempts) {
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      const text = (await response.text()).slice(0, 4000);
      lastStatus = response.status;
      lastBody = text;

      if (response.ok) {
        return {
          outcome: 'delivered',
          attempts,
          status: response.status,
          ok: true,
          body: text,
          url,
          method,
          requestBody: body,
          contentType,
          durationMs: Date.now() - started,
        };
      }

      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      lastError = `Buyer responded ${response.status}`;
      if (!retryable) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    if (attempts < maxAttempts) await sleep(backoffMs * 2 ** (attempts - 1));
  }

  logger.warn('lead delivery failed', { url, attempts, status: lastStatus, error: lastError });

  return {
    outcome: 'failed',
    attempts,
    status: lastStatus,
    ok: false,
    body: lastBody,
    error: lastError,
    url,
    method,
    requestBody: body,
    contentType,
    durationMs: Date.now() - started,
  };
}
