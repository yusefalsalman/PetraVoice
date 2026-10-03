import { motion } from 'framer-motion'
import { Mic, Square } from 'lucide-react'
import { useT } from '../lib/i18n'
import Waveform from './Waveform'

interface Props {
  recording: boolean
  disabled?: boolean
  onClick: () => void
}

/**
 * Centred "speak your trip" button. While recording it expands into a listening bar
 * with the live waveform; tapping anywhere on it stops and sends.
 */
export default function MicButton({
  recording,
  disabled,
  onClick,
  analyser,
}: Props & { analyser: AnalyserNode | null }) {
  const t = useT()
  return (
    <div className="relative flex justify-center">
      {/* Soft breathing halo behind the idle button. */}
      {!recording && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1/2 w-64 -translate-x-1/2 rounded-full bg-accent/20 blur-xl"
          animate={{ opacity: [0.35, 0.8, 0.35], scale: [0.92, 1.04, 0.92] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <motion.button
        layout
        type="button"
        onClick={onClick}
        disabled={disabled}
        whileTap={{ scale: 0.97 }}
        aria-label={recording ? t.stopAndSend : t.cta}
        aria-pressed={recording}
        transition={{ layout: { type: 'spring', stiffness: 380, damping: 32 } }}
        style={{ borderRadius: 9999 }}
        className={`relative flex min-h-14 items-center gap-3 outline-offset-4 transition-[background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${
          recording
            ? 'w-full bg-surface px-2 shadow-lg shadow-accent/10 ring-2 ring-accent'
            : 'bg-accent px-7 text-accent-ink shadow-lg shadow-accent/30 hover:bg-accent-hover hover:shadow-xl hover:shadow-accent/35'
        }`}
      >
        {recording ? (
          <>
            <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
              <motion.span
                className="absolute inset-0 rounded-full bg-accent"
                animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
              />
              <Square className="relative size-4" fill="currentColor" aria-hidden />
            </span>
            <span className="shrink-0 text-sm font-bold text-accent">{t.listening}</span>
            <span className="min-w-0 flex-1">
              <Waveform analyser={analyser} className="h-10 w-full" />
            </span>
          </>
        ) : (
          <>
            <Mic className="size-6" strokeWidth={2.2} aria-hidden />
            <span className="text-base font-bold tracking-tight">{t.cta}</span>
          </>
        )}
      </motion.button>
    </div>
  )
}

/** Compact mic embedded inside the destination input. */
export function MicIconButton({ recording, disabled, onClick }: Props) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={recording ? t.stopAndSend : t.inlineMic}
      aria-pressed={recording}
      className={`relative grid size-11 shrink-0 place-items-center rounded-full transition disabled:opacity-40 ${
        recording ? 'bg-accent text-accent-ink' : 'text-accent hover:bg-accent/10'
      }`}
    >
      {recording && (
        <motion.span
          className="absolute inset-0 rounded-full bg-accent"
          animate={{ scale: [1, 1.45], opacity: [0.4, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      {recording ? (
        <Square className="relative size-4" fill="currentColor" aria-hidden />
      ) : (
        <Mic className="size-5" strokeWidth={2.2} aria-hidden />
      )}
    </button>
  )
}
