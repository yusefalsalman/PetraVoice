import { motion } from 'framer-motion'
import { useT } from '../lib/i18n'
import { useRideStore } from '../store/useRideStore'

export default function ProcessingScreen() {
  const t = useT()
  const reset = useRideStore((s) => s.reset)

  return (
    <div className="flex flex-col items-center gap-5 px-5 pb-6 pt-6 text-center">
      <div className="flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-3 rounded-full bg-accent"
            animate={{ y: [0, -8, 0], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-xl font-bold">
        {t.processing}
      </p>
      <p className="-mt-3 text-sm text-muted">{t.processingSub}</p>

      <div className="w-full space-y-3" aria-hidden>
        {[0, 1].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>

      <button type="button" onClick={reset} className="min-h-11 px-4 text-sm text-muted hover:text-fg">
        {t.cancel}
      </button>
    </div>
  )
}
