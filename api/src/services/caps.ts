import { prisma } from '../db';
import type { CampaignCounts } from '../core/types';
import { startOfLocalDay, startOfLocalMonth } from './time';

/** Statuses that consume a campaign's cap: a lead that was actually awarded. */
export const CONSUMING_STATUSES = ['sold', 'delivered', 'delivery_failed'] as const;

/**
 * Count awarded leads per campaign for the current day and month, plus how many
 * are still in flight (awarded but not yet confirmed delivered).
 *
 * Both the ping and the post path call this — caps are re-checked at award time
 * so a burst of concurrent pings can't oversell a capped campaign.
 */
export async function loadCampaignCounts(
  campaignIds: string[],
  now: Date,
  timeZone: string
): Promise<Record<string, CampaignCounts>> {
  const counts: Record<string, CampaignCounts> = {};
  for (const id of campaignIds) counts[id] = { daily: 0, monthly: 0, concurrent: 0 };
  if (campaignIds.length === 0) return counts;

  const dayStart = startOfLocalDay(now, timeZone);
  const monthStart = startOfLocalMonth(now, timeZone);

  const [monthRows, dayRows, inflightRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: campaignIds },
        status: { in: [...CONSUMING_STATUSES] },
        createdAt: { gte: monthStart },
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: campaignIds },
        status: { in: [...CONSUMING_STATUSES] },
        createdAt: { gte: dayStart },
      },
      _count: { _all: true },
    }),
    // "Concurrent" = awarded and not yet confirmed delivered.
    prisma.lead.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: campaignIds }, status: 'sold' },
      _count: { _all: true },
    }),
  ]);

  for (const row of monthRows) {
    if (row.campaignId && counts[row.campaignId]) counts[row.campaignId].monthly = row._count._all;
  }
  for (const row of dayRows) {
    if (row.campaignId && counts[row.campaignId]) counts[row.campaignId].daily = row._count._all;
  }
  for (const row of inflightRows) {
    if (row.campaignId && counts[row.campaignId]) counts[row.campaignId].concurrent = row._count._all;
  }

  return counts;
}
