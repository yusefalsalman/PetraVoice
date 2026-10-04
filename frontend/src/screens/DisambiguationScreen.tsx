import { motion } from 'framer-motion'
import { ChevronLeft, GraduationCap, Hospital, MapPin, Mic, School, ShoppingBag, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { placeArea, placeName, useLang, useT } from '../lib/i18n'
import { choicePrompt, optionsCategory, speak, speechLang, stopSpeaking, type PlaceCategory } from '../lib/speech'
import { useRideStore } from '../store/useRideStore'

const CATEGORY_ICON: Record<PlaceCategory, LucideIcon> = {
  university: GraduationCap,
  hospital: Hospital,
  school: School,
  mall: ShoppingBag,
}

/**
 * «قصدك؟» — the request named a place that fits several: two similar map results, or up to five
 * well-known places for a generic category («وصلني ع المستشفى»). Tapping one fills that side and
 * the route and fare are calculated straight away; the rider can also say the name instead.
 */
export default function DisambiguationScreen() {
  const t = useT()
  const lang = useLang((s) => s.lang)
  const transcript = useRideStore((s) => s.transcript)
  const liveOptions = useRideStore((s) => s.options)
  // Choosing clears the options while this screen animates out — keep showing the last ones.
  const lastOptions = useRef(liveOptions)
  if (liveOptions.length > 0) lastOptions.current = liveOptions
  const options = lastOptions.current
  const chooseOption = useRideStore((s) => s.chooseOption)
  const startRecording = useRideStore((s) => s.startRecording)
  const reset = useRideStore((s) => s.reset)

  const field = options[0]?.field ?? 'dropoff'
  const category = optionsCategory(options.map((o) => o.name))
  const Icon = category ? CATEGORY_ICON[category] : MapPin
  const { heading } = choicePrompt(category, field, lang)

  // Ask the question out loud, in the language the rider used.
  // Once per set of options; not after one was chosen.
  const optionsKey = options.map((o) => o.name).join('|')
  const chosen = liveOptions.length === 0
  useEffect(() => {
    if (chosen) return
    const spokenLang = speechLang(useRideStore.getState().transcript, useLang.getState().lang)
    const timer = setTimeout(() => void speak(choicePrompt(category, field, spokenLang).spoken, spokenLang), 400)
    return () => clearTimeout(timer)
  }, [optionsKey, chosen])
  useEffect(() => stopSpeaking, [])

  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
      <p className="text-sm text-muted">
        {t.yourRequest} <span className="text-fg">«{transcript}»</span>
      </p>
      <h2 className="text-2xl font-bold" aria-live="polite">
        {heading}
      </h2>

      <ul className="flex flex-col gap-2" aria-label={heading}>
        {options.map((opt, i) => {
          const area = placeArea(opt.name, lang)
          return (
            <motion.li
              key={`${opt.lat},${opt.lng}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2, ease: 'easeOut' }}
            >
              <button
                type="button"
                onClick={() => void chooseOption(opt)}
                className="group flex min-h-14 w-full items-center gap-3 rounded-2xl border border-field-border bg-surface px-3 py-2 text-start transition hover:border-accent/40 hover:bg-surface-2 focus-visible:border-accent focus-visible:outline-none active:scale-[0.99]"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-accent-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{placeName(opt.name, lang)}</span>
                  {area && <span className="block text-xs text-muted">{area}</span>}
                </span>
                {/* Points "forward": left in RTL, right in LTR. */}
                <ChevronLeft className="size-5 shrink-0 text-muted ltr:rotate-180" aria-hidden />
              </button>
            </motion.li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() => void startRecording()}
        className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-accent/30 text-sm font-semibold text-accent hover:bg-accent/5"
      >
        <Mic className="size-4" aria-hidden />
        {t.sayInstead}
      </button>
      <button type="button" onClick={reset} className="min-h-10 text-sm text-muted hover:text-fg">
        {t.neither}
      </button>
    </div>
  )
}
