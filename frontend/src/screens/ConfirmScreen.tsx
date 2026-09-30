import { AlertCircle, Bus, Car, CarFront, Loader2, type LucideIcon } from 'lucide-react'
import FareCard from '../components/FareCard'
import { LocationCard } from '../components/LocationRow'
import { fareForTier } from '../lib/fare'
import { errorText, useT } from '../lib/i18n'
import { straightLineKm } from '../lib/location'
import { useRideStore } from '../store/useRideStore'
import type { RideType } from '../types/api'

const RIDE_TYPES: { id: RideType; seats: number; Icon: LucideIcon }[] = [
  { id: 'economy', seats: 4, Icon: Car },
  { id: 'comfort', seats: 4, Icon: CarFront },
  { id: 'xl', seats: 6, Icon: Bus },
]

/** Straight lines are shorter than roads — rough city factor for fare estimates without a route. */
const ROAD_FACTOR = 1.3

export default function ConfirmScreen() {
  const t = useT()
  const s = useRideStore()
  const missing = !s.pickup ? t.missingPickup : !s.dropoff ? t.missingDropoff : null
  const canConfirm = !missing && !s.submitting && !s.resolving

  const distanceKm =
    s.route?.distanceKm ??
    (s.pickup && s.dropoff ? Math.round(straightLineKm(s.pickup, s.dropoff) * ROAD_FACTOR * 10) / 10 : null)
  const fareFor = (tier: RideType) =>
    s.pickup && s.dropoff ? fareForTier(tier, s.fareEstimate, s.parsedRideType, distanceKm) : null

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
      <LocationCard />

      {s.transcript && (
        <p className="text-sm text-muted">
          {t.yourRequest} <span className="text-fg">«{s.transcript}»</span>
        </p>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">{t.rideTypeLegend}</legend>
        <div className="grid grid-cols-3 gap-2">
          {RIDE_TYPES.map(({ id, seats, Icon }) => {
            const active = s.rideType === id
            const fare = fareFor(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => s.setRideType(id)}
                aria-pressed={active}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 transition ${
                  active ? 'border-accent bg-surface-2' : 'border-transparent bg-surface ring-1 ring-border'
                }`}
              >
                <Icon className={`size-6 ${active ? 'text-accent' : 'text-muted'}`} aria-hidden />
                <span className="text-sm font-bold">{t.rideTypes[id]}</span>
                <span className="text-[11px] text-muted">{t.seats(seats)}</span>
                {fare && !s.resolving && (
                  <span className={`text-xs font-bold ${active ? 'text-accent' : 'text-fg'}`}>
                    {fare.min.toFixed(2)} {t.jodShort}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </fieldset>

      <FareCard fare={fareFor(s.rideType)} route={s.route} loading={s.resolving} />

      {s.error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <p>{errorText(t, s.error)}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void s.confirm()}
        disabled={!canConfirm}
        className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-accent text-lg font-bold text-accent-ink shadow-lg shadow-accent/20 transition active:scale-[0.98] disabled:opacity-50"
      >
        {s.submitting && <Loader2 className="size-5 animate-spin" aria-hidden />}
        {s.submitting ? t.confirming : t.confirm}
      </button>
      <p className="-mt-2 text-center text-xs text-muted">{missing ?? t.safetyNote}</p>

      <button
        type="button"
        onClick={s.reset}
        disabled={s.submitting}
        className="min-h-11 text-sm text-muted hover:text-fg disabled:opacity-40"
      >
        {t.startOver}
      </button>
    </div>
  )
}
