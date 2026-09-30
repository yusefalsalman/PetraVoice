import { motion } from 'framer-motion'
import { Loader2, LocateFixed, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { placeName, useLang, useT, type Lang } from '../lib/i18n'
import { isCurrentLocation } from '../lib/location'
import { useRideStore, type Field } from '../store/useRideStore'
import type { Place } from '../types/api'
import { MicIconButton } from './MicButton'

function ConfidenceBadge({ value }: { value: number }) {
  const t = useT()
  const pct = Math.round(value * 100)
  const high = value >= 0.9
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${high ? 'bg-pickup/10 text-pickup' : 'bg-amber-100 text-amber-700'}`}
      aria-label={t.confidence(pct)}
    >
      {pct}%
    </span>
  )
}

interface RowProps {
  field: Field
  value: string
  place: Place | null
  onChange: (value: string) => void
  disabled?: boolean
  /** Shown at the end of the row (left in RTL, right in LTR), e.g. the inline mic. */
  trailing?: ReactNode
}

/** One editable location line: marker + text input + confidence badge. */
export default function LocationRow({ field, value, place, onChange, disabled, trailing }: RowProps) {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const isPickup = field === 'pickup'
  // Badge only while the text still matches what was resolved.
  const showBadge = place && !isCurrentLocation(place.name) && value.trim() === placeName(place.name, lang)

  return (
    <label className="flex min-h-12 items-center gap-3">
      {isPickup ? (
        // Green GPS mark: an empty pickup means "my current location".
        <LocateFixed className="size-4 shrink-0 text-pickup" strokeWidth={2.5} aria-hidden />
      ) : (
        <span className="mx-0.5 size-3 shrink-0 rounded-[3px] bg-accent" aria-hidden />
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isPickup ? t.currentLocation : t.dropoffPlaceholder}
        aria-label={isPickup ? t.pickupLabel : t.dropoffLabel}
        disabled={disabled}
        enterKeyHint="search"
        className={`min-w-0 flex-1 bg-transparent py-2 font-bold text-fg placeholder:font-medium focus:outline-none disabled:opacity-60 ${
          isPickup ? 'placeholder:text-pickup' : 'placeholder:text-muted/80'
        }`}
      />
      {showBadge && <ConfidenceBadge value={place.confidence} />}
      {trailing}
    </label>
  )
}

/** Reveals `target` a few characters at a time whenever it changes; null once fully shown. */
function useTypewriter(target: string | null): string | null {
  const [state, setState] = useState({ target, shown: 0 })
  if (state.target !== target) setState({ target, shown: 0 })

  useEffect(() => {
    if (!target || state.shown >= target.length) return
    const t = setTimeout(() => setState((s) => ({ ...s, shown: s.shown + 1 })), 28)
    return () => clearTimeout(t)
  }, [target, state.shown])

  return target && state.shown < target.length ? target.slice(0, state.shown) : null
}

/** Field text for a place in the current language; empty pickup = "current location" placeholder. */
function fieldText(p: Place | null, fallback: string, lang: Lang, field: Field): string {
  if (!p) return placeName(fallback, lang)
  if (field === 'pickup' && isCurrentLocation(p.name)) return ''
  return placeName(p.name, lang)
}

/**
 * Pickup + destination inputs, with a mic inside the destination field.
 * Typing and submitting re-resolves both names through /api/parse-ride.
 */
export function LocationCard() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const status = useRideStore((s) => s.status)
  const pickup = useRideStore((s) => s.pickup)
  const dropoff = useRideStore((s) => s.dropoff)
  const resolving = useRideStore((s) => s.resolving)
  const typed = useRideStore((s) => s.typed)
  const resolveNames = useRideStore((s) => s.resolveNames)
  const startRecording = useRideStore((s) => s.startRecording)
  const stopRecording = useRideStore((s) => s.stopRecording)

  // Local text in the current language, re-seeded when the store resolves new places or the
  // language changes (falls back to what was typed).
  const seed = () => ({
    pickup: fieldText(pickup, typed.pickup, lang, 'pickup'),
    dropoff: fieldText(dropoff, typed.dropoff, lang, 'dropoff'),
  })
  const [texts, setTexts] = useState(seed)
  const [seen, setSeen] = useState({ pickup, dropoff, lang })
  if (seen.pickup !== pickup || seen.dropoff !== dropoff || seen.lang !== lang) {
    setSeen({ pickup, dropoff, lang })
    setTexts(seed())
  }

  // Freshly resolved destinations "type themselves" into the field.
  const typing = useTypewriter(dropoff ? placeName(dropoff.name, lang) : null)
  const recording = status === 'recording'
  const busy = resolving || status === 'processing'
  const dirty =
    texts.pickup.trim() !== fieldText(pickup, '', lang, 'pickup') ||
    texts.dropoff.trim() !== fieldText(dropoff, '', lang, 'dropoff')
  const hasResult = status === 'confirming'

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (dirty && !busy) void resolveNames(texts.pickup, texts.dropoff)
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl bg-surface p-3 shadow-sm ring-1 ring-border">
      <LocationRow
        field="pickup"
        value={texts.pickup}
        place={pickup}
        onChange={(v) => setTexts((s) => ({ ...s, pickup: v }))}
        disabled={busy || recording}
      />
      <div className="ms-2 h-2 border-s-2 border-dotted border-border" aria-hidden />
      {/* Re-keyed per destination so a new result fades in with a soft blue highlight. */}
      <motion.div
        key={dropoff?.name ?? 'empty'}
        initial={dropoff ? { backgroundColor: '#bfdbfe' } : false}
        animate={{ backgroundColor: '#eff6ff' }}
        transition={{ duration: 1.4, ease: 'easeOut' }}
        className="-mx-1.5 rounded-xl py-0.5 pe-1 ps-1.5"
      >
        <LocationRow
          field="dropoff"
          value={typing ?? texts.dropoff}
          place={typing === null ? dropoff : null}
          onChange={(v) => setTexts((s) => ({ ...s, dropoff: v }))}
          disabled={busy || recording}
          trailing={
            // Divider + mic, pinned to the far end of the field.
            <span className="flex shrink-0 items-center border-s border-sky/20 ps-1">
              <MicIconButton
                recording={recording}
                disabled={busy}
                onClick={() => void (recording ? stopRecording() : startRecording())}
              />
            </span>
          }
        />
      </motion.div>

      {(dirty || busy) && (
        <button
          type="submit"
          disabled={busy || !texts.dropoff.trim()}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-bold text-accent-ink disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : hasResult ? (
            <RefreshCw className="size-4" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          {busy ? t.resolving : hasResult ? t.updateRoute : t.findRide}
        </button>
      )}
    </form>
  )
}
