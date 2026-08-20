export type FieldType = 'text' | 'number' | 'enum' | 'boolean';

export interface VerticalField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

export interface Vertical {
  id: string;
  key: string;
  name: string;
  active: boolean;
  fieldSchema: VerticalField[];
  createdAt: string;
  _count?: { campaigns: number; leads: number; pings: number };
}

export interface Source {
  id: string;
  name: string;
  apiKey: string;
  active: boolean;
  createdAt: string;
  _count?: { pings: number; leads: number };
}

export type DeliveryMethod = 'json' | 'form' | 'xml';

export interface Buyer {
  id: string;
  name: string;
  active: boolean;
  deliveryUrl: string | null;
  deliveryMethod: DeliveryMethod;
  deliveryHeaders: Record<string, string>;
  fieldMapping: Record<string, string>;
  createdAt: string;
  _count?: { campaigns: number; leads: number };
}

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'exists';

export interface FilterRule {
  field: string;
  op: FilterOp;
  value?: string | number | boolean | (string | number)[];
}

export interface Schedule {
  days?: number[];
  start?: string;
  end?: string;
}

export interface Campaign {
  id: string;
  buyerId: string;
  name: string;
  verticalId: string;
  active: boolean;
  bid: string | number;
  routingPriority: number;
  states: string[];
  zips: string[];
  filters: FilterRule[];
  dailyCap: number;
  monthlyCap: number;
  concurrencyCap: number;
  schedule: Schedule;
  createdAt: string;
  buyer?: Buyer;
  vertical?: Vertical;
  _count?: { leads: number };
}

export type LeadStatus = 'sold' | 'delivered' | 'delivery_failed' | 'rejected_dup';

export interface Lead {
  id: string;
  pingId: string | null;
  sourceId: string;
  campaignId: string | null;
  buyerId: string | null;
  verticalId: string;
  price: string | number;
  payload: Record<string, unknown>;
  status: LeadStatus;
  deliveryResponse: Record<string, unknown> | null;
  deliveryAttempts: number;
  createdAt: string;
  buyer?: Buyer | null;
  campaign?: Campaign | null;
  vertical?: Vertical;
  source?: Source;
}

export type PingStatus = 'open' | 'no_bid' | 'posted' | 'expired';

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
  reason: string;
  detail?: string;
}

export interface Ping {
  id: string;
  sourceId: string;
  verticalId: string;
  payload: Record<string, unknown>;
  matched: Offer[];
  rejected: Rejection[];
  bestCampaignId: string | null;
  bestBid: string | null;
  status: PingStatus;
  expiresAt: string;
  createdAt: string;
  vertical?: Vertical;
  source?: Source;
  leads?: { id: string; status: LeadStatus }[];
}

export type RoutingStrategy = 'bid' | 'priority' | 'round_robin';

export interface PlatformSettings {
  routingStrategy: RoutingStrategy;
  dedupWindowDays: number;
  pingTtlSeconds: number;
  timezone: string;
  routingStrategies: RoutingStrategy[];
}

export interface Stats {
  range: { from: string; to: string };
  revenue: { total: number; today: number; range: number };
  leads: {
    total: number;
    today: number;
    range: number;
    delivered: number;
    deliveryFailed: number;
    duplicates: number;
  };
  pings: { range: number; today: number; noBid: number; matched: number };
  rates: { fillRate: number; noBidRate: number; conversionRate: number; deliveryRate: number };
  averagePrice: number;
}

export interface TimeseriesPoint {
  date: string;
  revenue: number;
  leads: number;
  pings: number;
  matched: number;
  fillRate: number;
}

export interface RollupRow {
  id: string;
  name: string;
  leads: number;
  revenue: number;
  averagePrice: number;
  extra?: { pings?: number; fillRate?: number };
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  revenue?: number;
}

export interface PingResponse {
  ping_id: string;
  status: 'open' | 'no_bid';
  expires_at: string;
  winner: Offer | null;
  offers: Offer[];
  matched: number;
  rejected: Rejection[];
  vertical: string;
  routing_strategy: string;
}

export interface PostResponse {
  accepted: boolean;
  lead_id: string;
  status: LeadStatus;
  sold_to: {
    buyer_id: string;
    buyer_name: string;
    campaign_id: string;
    campaign_name: string;
  } | null;
  price: number;
  vertical: string;
  delivery: {
    outcome: string;
    attempts: number;
    status?: number;
    error?: string;
    response?: unknown;
  };
  reason?: string;
}

export interface DeliveryResult {
  outcome: string;
  attempts: number;
  status?: number;
  ok?: boolean;
  body?: string;
  error?: string;
  url?: string;
  method?: string;
  requestBody?: string;
  durationMs?: number;
}
