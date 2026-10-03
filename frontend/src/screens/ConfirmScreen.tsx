import { AlertCircle, Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import FareCard from '../components/FareCard'
import { LocationCard } from '../components/LocationRow'
import { fareForTier } from '../lib/fare'
import { errorText, useLang, useT } from '../lib/i18n'
import { straightLineKm } from '../lib/location'
import { confirmationText, speak, speechLang, stopSpeaking } from '../lib/speech'
import { useRideStore } from '../store/useRideStore'
import type { RideType } from '../types/api'

/** 3D renders in public/cars (Microsoft Fluent Emoji 3D, MIT — see public/cars/LICENSE.txt). */
const RIDE_TYPES: { id: RideType; seats: number; image: string }[] = [
  { id: 'economy', seats: 4, image: '/cars/economy.png' }, // silver car
  { id: 'comfort', seats: 4, image: '/cars/comfort.png' }, // navy car
  { id: 'xl', seats: 6, image: '/cars/xl.png' }, // family van
]

/** Straight lines are shorter than roads — rough city factor for fare estimates without a route. */
const ROAD_FACTOR = 1.3
/** Let the map fly to the route and the fare render before the voice starts. */
const SPEAK_DELAY_MS = 700

/** Speaks each newly arrived ride (route + fare) once, in the language the rider used. */
function useSpokenConfirmation() {
  const announce = useRideStore((s) => s.announce)
  useEffect(() => {
    if (!announce) return
    const timer = setTimeout(() => {
      const s = useRideStore.getState()
      if (s.status !== 'confirming' || !s.pickup || !s.dropoff) return
      const fare = fareForTier(s.rideType, s.fareEstimate, s.parsedRideType, null)
      if (!fare) return
      const lang = speechLang(s.transcript, useLang.getState().lang)
      void speak(confirmationText({ pickup: s.pickup, dropoff: s.dropoff, rideType: s.rideType, fare: fare.min }, lang), lang)
    }, SPEAK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [announce])
  useEffect(() => stopSpeaking, [])
}

export default function ConfirmScreen() {
  const t = useT()
  const s = useRideStore()
  useSpokenConfirmation()
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
          {RIDE_TYPES.map(({ id, seats, image }) => {
            const active = s.rideType === id
            const fare = fareFor(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => s.setRideType(id)}
                aria-pressed={active}
                className={`group flex min-w-0 flex-col items-center gap-0.5 rounded-2xl border-2 px-1.5 pb-2.5 pt-2 transition ${
                  active ? 'border-accent bg-surface-2' : 'border-transparent bg-surface ring-1 ring-border hover:ring-accent/25'
                }`}
              >
                <img
                  src={image}
                  alt=""
                  aria-hidden
                  draggable={false}
                  width={224}
                  height={153}
                  className={`mb-0.5 size-7 object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.15)] transition-transform duration-200 ${
                    active ? 'scale-105' : 'opacity-90 group-hover:scale-105'
                  }`}
                />
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
        className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-accent text-lg font-bold text-accent-ink shadow-lg shadow-accent/25 transition hover:bg-accent-hover hover:shadow-xl hover:shadow-accent/30 active:scale-[0.98] disabled:opacity-50"
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
