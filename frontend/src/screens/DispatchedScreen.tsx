import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import { placeName, useLang, useT } from '../lib/i18n'
import { isCurrentLocation } from '../lib/location'
import { useRideStore } from '../store/useRideStore'

export default function DispatchedScreen() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const booking = useRideStore((s) => s.booking)
  const pickup = useRideStore((s) => s.pickup)
  const dropoff = useRideStore((s) => s.dropoff)
  const reset = useRideStore((s) => s.reset)

  return (
    <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-5 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <CheckCircle2 className="size-16 text-pickup" aria-hidden />
      </motion.div>

      <h2 role="status" className="text-2xl font-bold">
        {t.booked}
      </h2>
      {booking && (
        <p className="text-lg">
          {t.driverOnWay} <span className="font-bold text-accent">{t.minutes(booking.etaMinutes)}</span>
        </p>
      )}

      <div className="w-full space-y-1 rounded-2xl bg-surface-2 p-4 text-start text-sm">
        <p>
          <span className="text-muted">{t.from} </span>
          {isCurrentLocation(pickup?.name) ? t.currentLocation : pickup && placeName(pickup.name, lang)}
        </p>
        <p>
          <span className="text-muted">{t.to} </span>
          {dropoff && placeName(dropoff.name, lang)}
        </p>
        {booking && (
          <p className="pt-2 text-xs text-muted">
            {t.bookingId} <span dir="ltr" className="font-mono text-fg">{booking.bookingId}</span>
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={reset}
        className="min-h-12 w-full rounded-2xl bg-accent font-bold text-accent-ink"
      >
        {t.newRide}
      </button>
    </div>
  )
}
