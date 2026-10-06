import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, MapPin, Mic } from 'lucide-react'
import { useEffect } from 'react'
import { LocationCard } from '../components/LocationRow'
import MicButton from '../components/MicButton'
import { errorText, QUICK_DESTINATIONS, useLang, useT } from '../lib/i18n'
import { speak } from '../lib/speech'
import { useRideStore, type UiError } from '../store/useRideStore'

/** Errors where recording again is the fix (not a blocked or missing microphone). */
const RETRYABLE = ['STT_FAILED', 'NO_LOCATION_FOUND', 'NO_SPEECH', 'INVALID_AUDIO', 'SERVER_ERROR']
const NOT_UNDERSTOOD = ['STT_FAILED', 'NO_LOCATION_FOUND', 'NO_SPEECH', 'INVALID_AUDIO']

export default function HomeScreen() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const status = useRideStore((s) => s.status)
  const analyser = useRideStore((s) => s.analyser)
  const error = useRideStore((s) => s.error)
  const resolveNames = useRideStore((s) => s.resolveNames)
  const startRecording = useRideStore((s) => s.startRecording)
  const stopRecording = useRideStore((s) => s.stopRecording)
  const dismissError = useRideStore((s) => s.dismissError)
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
              className="group flex min-h-11 items-center gap-2 rounded-full border border-field-border bg-surface px-3 text-start text-sm font-semibold text-fg transition hover:border-accent/30 hover:bg-surface-2 active:scale-[0.98] disabled:opacity-50"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-accent-ink">
                <MapPin className="size-3.5" strokeWidth={2.4} aria-hidden />
              </span>
              <span className="truncate">{label[lang]}</span>
            </button>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {error && (
          <ErrorDialog
            key={error.code + error.message}
            error={error}
            onRetry={() => void startRecording()}
            onClose={dismissError}
          />
        )}
      </AnimatePresence>

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

/** Small dialog over the home screen: what went wrong, said out loud, with «أعد التسجيل». */
function ErrorDialog({ error, onRetry, onClose }: { error: UiError; onRetry: () => void; onClose: () => void }) {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const message = errorText(t, error)
  const retryable = RETRYABLE.includes(error.code)

  useEffect(() => {
    if (!retryable) return
    const timer = setTimeout(() => void speak(message, lang), 250)
    return () => clearTimeout(timer)
  }, [message, lang, retryable])

  return (
    <motion.div
      className="fixed inset-0 z-[2000] grid place-items-center bg-black/40 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-title"
        aria-describedby="error-message"
        className="w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-2xl"
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-red-50 text-danger ring-1 ring-red-200">
          <AlertCircle className="size-7" aria-hidden />
        </span>
        <h3 id="error-title" className="mt-3 text-lg font-bold text-fg">
          {NOT_UNDERSTOOD.includes(error.code) ? t.notUnderstood : t.somethingWrong}
        </h3>
        <p id="error-message" className="mt-1 text-sm text-muted">
          {message}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {retryable && (
            <button
              type="button"
              autoFocus
              onClick={onRetry}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent font-bold text-accent-ink shadow-lg shadow-accent/25 outline-none transition hover:bg-accent-hover focus-visible:ring-4 focus-visible:ring-accent/30 active:scale-[0.98]"
            >
              <Mic className="size-5" aria-hidden />
              {t.recordAgain}
            </button>
          )}
          <button
            type="button"
            autoFocus={!retryable}
            onClick={onClose}
            className="min-h-11 rounded-2xl font-semibold text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            {t.close}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
