import { motion } from 'framer-motion'
import { Loader2, LocateFixed, RefreshCw, Search } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { placeName, useLang, useT, type Lang } from '../lib/i18n'
import { isCurrentLocation, splitNotes } from '../lib/location'
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
  /** Changes when a new result arrives: the pill flashes a navy tint, then settles. */
  highlightKey?: string | null
}

/** Dotted connector between the pickup and destination markers. */
function Dots({ className = '' }: { className?: string }) {
  return <span className={`w-0 border-s-2 border-dotted border-slate-300 ${className}`} aria-hidden />
}

// Pill colours as literals: framer-motion interpolates them for the arrival flash.
const FIELD_BG = '#f9fafb' // --pv-field
const FLASH_BG = '#dfe5f1' // light Petra navy

/** Landmark part of a place name in the UI language, without any « • gate» note. */
const mainText = (name: string, lang: Lang) => placeName(splitNotes(name).main, lang)

/** One editable location line: marker + text input + confidence badge (+ gate note underneath). */
export default function LocationRow({ field, value, place, onChange, disabled, trailing, highlightKey }: RowProps) {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const isPickup = field === 'pickup'
  // Badge and note only while the text still matches what was resolved.
  const resolved = place && !isCurrentLocation(place.name) && value.trim() === mainText(place.name, lang) ? place : null
  const notes = resolved ? splitNotes(resolved.name).notes : null

  return (
    <div className="flex gap-3">
      {/* Marker column, lined up with the input line: pickup ⋮ destination. */}
      <div className="flex w-4 shrink-0 flex-col items-center">
        {isPickup ? (
          <>
            <div className="flex h-12 flex-col items-center justify-end">
              {/* Green GPS mark: an empty pickup means "my current location". */}
              <LocateFixed className="mb-1 size-4 text-pickup" strokeWidth={2.5} aria-hidden />
              <Dots className="h-2.5" />
            </div>
            <Dots className="flex-1" />
          </>
        ) : (
          <div className="flex h-12 flex-col items-center">
            <Dots className="h-[1.1rem]" />
            <span className="mt-1 size-3 rounded-[3px] bg-accent" aria-hidden />
          </div>
        )}
      </div>

      <motion.div
        key={highlightKey ?? 'static'}
        initial={highlightKey ? { backgroundColor: FLASH_BG } : false}
        animate={{ backgroundColor: FIELD_BG }}
        transition={{ duration: 1.4, ease: 'easeOut' }}
        className="min-w-0 flex-1 rounded-xl border border-field-border px-3 transition-[border-color,box-shadow] duration-200 focus-within:border-accent/40 focus-within:shadow-[0_0_0_3px_rgb(0_23_75/0.08)]"
      >
        <label className="flex min-h-12 items-center gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={isPickup ? t.currentLocation : t.dropoffPlaceholder}
            aria-label={isPickup ? t.pickupLabel : t.dropoffLabel}
            disabled={disabled}
            enterKeyHint="search"
            className={`min-w-0 flex-1 bg-transparent py-2 text-[15px] font-bold text-fg placeholder:font-medium focus:outline-none disabled:opacity-60 ${
              isPickup ? 'placeholder:text-pickup' : 'placeholder:text-muted/80'
            }`}
          />
          {resolved && <ConfidenceBadge value={resolved.confidence} />}
          {trailing}
        </label>
        {/* Gate / entrance the rider said («بوابة 2») — kept out of the map search, shown here. */}
        {notes && (
          <p className="-mt-1.5 truncate pb-2 text-xs text-muted">
            {mainText(resolved!.name, lang)} • <span className="font-medium text-accent">{notes}</span>
          </p>
        )}
      </motion.div>
    </div>
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
  return mainText(p.name, lang)
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
  const typing = useTypewriter(dropoff ? mainText(dropoff.name, lang) : null)
  const recording = status === 'recording'
  const busy = resolving || status === 'processing'
  const dirty =
    texts.pickup.trim() !== fieldText(pickup, '', lang, 'pickup') ||
    texts.dropoff.trim() !== fieldText(dropoff, '', lang, 'dropoff')
  const hasResult = status === 'confirming'

  // A side the rider didn't touch keeps its gate note when the other side is re-resolved.
  const withNotes = (field: Field, place: Place | null) => {
    const text = texts[field].trim()
    const notes = place ? splitNotes(place.name).notes : null
    return notes && text === fieldText(place, '', lang, field) ? `${text} ${notes}` : text
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (dirty && !busy) void resolveNames(withNotes('pickup', pickup), withNotes('dropoff', dropoff))
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
      {/* The dotted line continues through the gap between the two pills. */}
      <div className="flex h-2 gap-3" aria-hidden>
        <div className="flex w-4 justify-center">
          <Dots />
        </div>
      </div>
      <LocationRow
        field="dropoff"
        value={typing ?? texts.dropoff}
        place={typing === null ? dropoff : null}
        onChange={(v) => setTexts((s) => ({ ...s, dropoff: v }))}
        disabled={busy || recording}
        // A new destination flashes in.
        highlightKey={dropoff?.name ?? null}
        trailing={
          // Divider + mic, pinned to the far end of the field.
          <span className="-me-2 flex shrink-0 items-center border-s border-field-border ps-1">
            <MicIconButton
              recording={recording}
              disabled={busy}
              onClick={() => void (recording ? stopRecording() : startRecording())}
            />
          </span>
        }
      />

      {(dirty || busy) && (
        <button
          type="submit"
          disabled={busy || !texts.dropoff.trim()}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-bold text-accent-ink shadow-md shadow-accent/20 transition hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
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
