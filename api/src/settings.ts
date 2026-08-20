import { prisma } from './db';
import { isRoutingStrategy } from './core/ranking';
import type { RoutingStrategy } from './core/types';

/**
 * Global runtime configuration, stored in the `Setting` table so it can be
 * changed from the dashboard without a redeploy.
 */
export const SETTING_KEYS = {
  routingStrategy: 'routing_strategy',
  dedupWindowDays: 'dedup_window_days',
  pingTtlSeconds: 'ping_ttl_seconds',
  timezone: 'timezone',
} as const;

export interface PlatformSettings {
  routingStrategy: RoutingStrategy;
  dedupWindowDays: number;
  pingTtlSeconds: number;
  timezone: string;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  routingStrategy: 'bid',
  dedupWindowDays: 30,
  pingTtlSeconds: 300, // 5 minutes
  timezone: 'UTC',
};

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function getSettings(): Promise<PlatformSettings> {
  const rows = await prisma.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const strategy = map.get(SETTING_KEYS.routingStrategy);
  return {
    routingStrategy: isRoutingStrategy(strategy) ? strategy : DEFAULT_SETTINGS.routingStrategy,
    dedupWindowDays: Math.max(
      0,
      toInt(map.get(SETTING_KEYS.dedupWindowDays), DEFAULT_SETTINGS.dedupWindowDays)
    ),
    pingTtlSeconds: Math.max(
      10,
      toInt(map.get(SETTING_KEYS.pingTtlSeconds), DEFAULT_SETTINGS.pingTtlSeconds)
    ),
    timezone: map.get(SETTING_KEYS.timezone) || DEFAULT_SETTINGS.timezone,
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function updateSettings(patch: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const writes: Promise<unknown>[] = [];
  if (patch.routingStrategy) writes.push(setSetting(SETTING_KEYS.routingStrategy, patch.routingStrategy));
  if (patch.dedupWindowDays !== undefined)
    writes.push(setSetting(SETTING_KEYS.dedupWindowDays, String(patch.dedupWindowDays)));
  if (patch.pingTtlSeconds !== undefined)
    writes.push(setSetting(SETTING_KEYS.pingTtlSeconds, String(patch.pingTtlSeconds)));
  if (patch.timezone) writes.push(setSetting(SETTING_KEYS.timezone, patch.timezone));
  await Promise.all(writes);
  return getSettings();
}

/**
 * Per-vertical rotation counter for the `round_robin` strategy. Incremented once
 * per ping so consecutive pings in a vertical hand the win to a different
 * campaign. Uses an atomic upsert+read so concurrent pings can't share a cursor.
 */
export async function nextRoundRobinCursor(verticalId: string): Promise<number> {
  const key = `rr_cursor:${verticalId}`;
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    INSERT INTO "Setting" ("key", "value", "updatedAt")
    VALUES (${key}, '1', NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = (COALESCE(NULLIF("Setting"."value", ''), '0')::bigint + 1)::text,
          "updatedAt" = NOW()
    RETURNING "value"
  `;
  const value = Number(rows[0]?.value ?? 0);
  return Number.isFinite(value) ? value - 1 : 0;
}
