import { ChevronLeft, MapPin } from 'lucide-react'
import { placeName, useLang, useT } from '../lib/i18n'
import { useRideStore } from '../store/useRideStore'

export default function DisambiguationScreen() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const transcript = useRideStore((s) => s.transcript)
  const options = useRideStore((s) => s.options)
  const chooseOption = useRideStore((s) => s.chooseOption)
  const reset = useRideStore((s) => s.reset)

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2">
      <p className="text-sm text-muted">
        {t.yourRequest} «{transcript}»
      </p>
      <h2 className="text-3xl font-bold" aria-live="polite">
        {t.didYouMean}
      </h2>

      {options.slice(0, 2).map((opt) => (
        <button
          key={`${opt.lat},${opt.lng}`}
          type="button"
          onClick={() => void chooseOption(opt)}
          className="flex min-h-20 items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-start shadow-sm transition hover:border-accent focus-visible:border-accent focus-visible:outline-none"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <MapPin className="size-5" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block text-xs text-muted">{opt.field === 'pickup' ? t.pickup : t.dropoff}</span>
            <span className="block text-lg font-bold">{placeName(opt.name, lang)}</span>
          </span>
          {/* Points "forward": left in RTL, right in LTR. */}
          <ChevronLeft className="size-5 text-muted ltr:rotate-180" aria-hidden />
        </button>
      ))}

      <button type="button" onClick={reset} className="min-h-11 text-sm text-muted hover:text-fg">
        {t.neither}
      </button>
    </div>
  )
}
