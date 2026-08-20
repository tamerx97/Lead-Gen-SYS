import { toOffer } from './matching';
import type { CampaignCandidate, Offer, RoutingStrategy } from './types';

export const ROUTING_STRATEGIES: RoutingStrategy[] = ['bid', 'priority', 'round_robin'];

export function isRoutingStrategy(value: unknown): value is RoutingStrategy {
  return typeof value === 'string' && (ROUTING_STRATEGIES as string[]).includes(value);
}

/**
 * Order the accepting campaigns.
 *
 * The full ranked list always goes back to the source — the strategy only
 * decides who sits at position 0 (the default winner on post).
 *
 *  - `bid`         highest bid wins (revenue-maximising exchange).
 *  - `priority`    lowest routingPriority wins (waterfall / preferred buyer).
 *  - `round_robin` even rotation across accepting campaigns for the vertical;
 *                  `cursor` is a per-vertical counter incremented once per ping.
 *
 * Ties break on the secondary criterion, then on campaign id, so a given set of
 * inputs always produces the same order.
 */
export function rankCampaigns(
  accepted: CampaignCandidate[],
  strategy: RoutingStrategy,
  cursor = 0
): CampaignCandidate[] {
  if (accepted.length <= 1) return [...accepted];

  switch (strategy) {
    case 'priority':
      return [...accepted].sort(
        (a, b) =>
          a.routingPriority - b.routingPriority ||
          b.bid - a.bid ||
          a.id.localeCompare(b.id)
      );

    case 'round_robin': {
      // Rotate a stable ordering so each accepting campaign takes a turn at the
      // front. `cursor` comes from a persisted per-vertical counter.
      const stable = [...accepted].sort((a, b) => a.id.localeCompare(b.id));
      const offset = ((cursor % stable.length) + stable.length) % stable.length;
      return [...stable.slice(offset), ...stable.slice(0, offset)];
    }

    case 'bid':
    default:
      return [...accepted].sort(
        (a, b) =>
          b.bid - a.bid ||
          a.routingPriority - b.routingPriority ||
          a.id.localeCompare(b.id)
      );
  }
}

export function rankOffers(
  accepted: CampaignCandidate[],
  strategy: RoutingStrategy,
  cursor = 0
): Offer[] {
  return rankCampaigns(accepted, strategy, cursor).map(toOffer);
}
