/**
 * Shared, storage-agnostic types for the matching/auction engine.
 *
 * Everything in `src/core` is intentionally pure: no Prisma, no I/O, no clock
 * reads that aren't passed in. That's what makes the auction unit-testable and
 * what keeps the engine free of any vertical-specific knowledge.
 */

export type FieldType = 'text' | 'number' | 'enum' | 'boolean';

/** One attribute in a vertical's user-defined `fieldSchema`. */
export interface VerticalField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'exists';

/** One campaign filter rule, evaluated against a vertical's fields. */
export interface FilterRule {
  field: string;
  op: FilterOp;
  value?: unknown;
}

/** `{}` or `{ days: [] }` means always-on. */
export interface Schedule {
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  days?: number[];
  /** "HH:MM", inclusive. */
  start?: string;
  /** "HH:MM", exclusive. Earlier than `start` means the window wraps midnight. */
  end?: string;
}

/** A campaign reduced to just what the auction needs. */
export interface CampaignCandidate {
  id: string;
  buyerId: string;
  buyerName?: string;
  name: string;
  verticalId: string;
  active: boolean;
  buyerActive: boolean;
  bid: number;
  routingPriority: number;
  states: string[];
  zips: string[];
  filters: FilterRule[];
  dailyCap: number;
  monthlyCap: number;
  concurrencyCap: number;
  schedule: Schedule;
}

/** The non-PII shape a ping matches against. */
export interface PingAttributes {
  state?: string | null;
  zip?: string | null;
  [key: string]: unknown;
}

/** Per-campaign counters used for cap enforcement. */
export interface CampaignCounts {
  daily: number;
  monthly: number;
  concurrent: number;
}

export interface MatchContext {
  /** Evaluation time. Passed in so schedule tests are deterministic. */
  now: Date;
  /** IANA timezone used to interpret campaign schedules. */
  timezone?: string;
  counts: Record<string, CampaignCounts>;
}

export type RejectReason =
  | 'campaign_inactive'
  | 'buyer_inactive'
  | 'vertical_mismatch'
  | 'geo_state'
  | 'geo_zip'
  | 'schedule'
  | 'daily_cap'
  | 'monthly_cap'
  | 'concurrency_cap'
  /** `filter:<fieldName>` — the specific rule that failed. */
  | `filter:${string}`;

export type MatchResult =
  | { accepted: true }
  | { accepted: false; reason: RejectReason; detail?: string };

/** A campaign that agreed to bid, as returned to the source. */
export interface Offer {
  campaign_id: string;
  campaign_name: string;
  buyer_id: string;
  buyer_name?: string;
  bid: number;
  routing_priority: number;
}

export interface Rejection {
  campaign_id: string;
  campaign_name: string;
  buyer_id: string;
  reason: RejectReason;
  detail?: string;
}

export type RoutingStrategy = 'bid' | 'priority' | 'round_robin';
