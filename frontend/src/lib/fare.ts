import type { FareEstimate, RideType } from '../types/api'

// Client-side display estimates per ride tier. The backend's fareEstimate stays the
// source of truth for the tier it returned; other tiers are scaled from it.
export const TIER_MULTIPLIER: Record<RideType, number> = { economy: 1, comfort: 1.35, xl: 1.7 }

const nickel = (n: number) => Math.round(n * 20) / 20

/**
 * Economy range from distance — same formula as backend/src/services/pricing.ts
 * (0.40 JOD base + 0.25 JOD/km, 1.00 JOD minimum, +15% upper range).
 */
export function economyFromDistance(km: number): FareEstimate {
  const min = Math.max(1, 0.4 + 0.25 * km)
  return { min: nickel(min), max: nickel(min * 1.15), currency: 'JOD' }
}

/**
 * Fare for `tier`. Uses the backend estimate when it is for the same tier; otherwise
 * scales it (or a distance-based economy price) by the tier multiplier.
 */
export function fareForTier(
  tier: RideType,
  backend: FareEstimate | null,
  backendTier: RideType,
  distanceKm: number | null,
): FareEstimate | null {
  if (backend && tier === backendTier) return backend
  const economy = backend
    ? { min: backend.min / TIER_MULTIPLIER[backendTier], max: backend.max / TIER_MULTIPLIER[backendTier] }
    : distanceKm !== null
      ? economyFromDistance(distanceKm)
      : null
  if (!economy) return null
  const m = TIER_MULTIPLIER[tier]
  return { min: nickel(economy.min * m), max: nickel(economy.max * m), currency: 'JOD' }
}
