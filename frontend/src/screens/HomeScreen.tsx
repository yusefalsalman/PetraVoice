import { AlertCircle, MapPin } from 'lucide-react'
import { LocationCard } from '../components/LocationRow'
import MicButton from '../components/MicButton'
import { errorText, QUICK_DESTINATIONS, useLang, useT } from '../lib/i18n'
import { useRideStore } from '../store/useRideStore'

export default function HomeScreen() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const status = useRideStore((s) => s.status)
  const analyser = useRideStore((s) => s.analyser)
  const error = useRideStore((s) => s.error)
  const resolveNames = useRideStore((s) => s.resolveNames)
  const startRecording = useRideStore((s) => s.startRecording)
  const stopRecording = useRideStore((s) => s.stopRecording)
  const recording = status === 'recording'

  return (
    <div className="flex flex-col gap-4 px-4 pt-2">
      <h2 className="text-xl font-bold">{recording ? t.listeningTitle : t.title}</h2>

      <LocationCard />

      <section aria-label={t.popular}>
        <p className="mb-2 text-xs font-medium text-muted">{t.popular}</p>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_DESTINATIONS.map(({ query, label }) => (
            <button
              key={query}
              type="button"
              // Sent in the UI language — the backend understands both and answers in kind.
              onClick={() => void resolveNames('', label[lang])}
              disabled={recording}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-surface px-3 text-start text-sm font-medium ring-1 ring-border hover:bg-surface-2 disabled:opacity-50"
            >
              <MapPin className="size-4 shrink-0 text-sky" aria-hidden />
              <span className="truncate">{label[lang]}</span>
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <p>{errorText(t, error)}</p>
        </div>
      )}

      {/* Speak-your-trip button, pinned to the bottom of the sheet. */}
      <div className="sticky bottom-0 -mx-4 bg-gradient-to-t from-bg from-60% to-transparent px-4 pb-5 pt-4">
        <MicButton
          recording={recording}
          analyser={analyser}
          onClick={() => void (recording ? stopRecording() : startRecording())}
        />
        <p aria-live="polite" className="mt-2 text-center text-xs text-muted">
          {recording ? t.hintRecording : t.hintIdle}
        </p>
      </div>
    </div>
  )
}
