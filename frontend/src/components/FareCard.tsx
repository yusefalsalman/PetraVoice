import { Clock, Route as RouteIcon } from 'lucide-react'
import { useT } from '../lib/i18n'
import type { FareEstimate, Route } from '../types/api'

interface Props {
  /** Estimate for the selected ride tier (see lib/fare.ts). */
  fare: FareEstimate | null
  route: Route | null
  loading: boolean
}

const jod = (n: number) => n.toFixed(2)

export default function FareCard({ fare, route, loading }: Props) {
  const t = useT()
  if (loading) return <div className="h-[72px] animate-pulse rounded-2xl bg-surface-2" aria-hidden />

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-accent/10">
      <div>
        <p className="text-xs text-muted">{t.fareTitle}</p>
        {fare ? (
          <p className="text-xl font-bold text-accent">
            {jod(fare.min)} – {jod(fare.max)} <span className="text-sm font-medium text-muted">{t.jod}</span>
          </p>
        ) : (
          <p className="font-medium text-muted">{t.fareTbd}</p>
        )}
      </div>

      {route && (
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm text-muted">
          <span className="flex items-center gap-1">
            <Clock className="size-4" aria-hidden /> {t.minutes(route.durationMinutes)}
          </span>
          <span className="flex items-center gap-1">
            <RouteIcon className="size-4" aria-hidden /> {t.km(route.distanceKm)}
          </span>
        </div>
      )}
    </div>
  )
}
