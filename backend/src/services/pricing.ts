import type { FareEstimate, RideType } from '../contract.ts'
import { nickel } from '../lib/text.ts'

// Fares in JOD. Keep in sync with frontend/src/lib/fare.ts, which scales the returned
// estimate to the other tiers with the same multipliers.

export const TIER_MULTIPLIER: Record<RideType, number> = { economy: 1, comfort: 1.35, xl: 1.7 }

const BASE_FARE = 0.4
const PER_KM = 0.25
const MIN_FARE = 1.0
/** Spread between the low and high end of the estimate (traffic, waiting). */
const RANGE = 1.15

/** Fare range for one tier over `distanceKm`. */
export function fareFor(distanceKm: number, tier: RideType): FareEstimate {
  const economyMin = Math.max(MIN_FARE, BASE_FARE + PER_KM * distanceKm)
  const m = TIER_MULTIPLIER[tier]
  return { min: nickel(economyMin * m), max: nickel(economyMin * RANGE * m), currency: 'JOD' }
}

/** All three tiers — the contract returns the requested one as `fareEstimate`. */
export function allFares(distanceKm: number): Record<RideType, FareEstimate> {
  return { economy: fareFor(distanceKm, 'economy'), comfort: fareFor(distanceKm, 'comfort'), xl: fareFor(distanceKm, 'xl') }
}
