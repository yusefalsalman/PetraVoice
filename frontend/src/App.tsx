import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import MapPreview from './components/MapPreview'
import { useLang, useT } from './lib/i18n'
import ConfirmScreen from './screens/ConfirmScreen'
import DisambiguationScreen from './screens/DisambiguationScreen'
import DispatchedScreen from './screens/DispatchedScreen'
import HomeScreen from './screens/HomeScreen'
import ProcessingScreen from './screens/ProcessingScreen'
import { useRideStore, type RideStatus } from './store/useRideStore'

/** Visible height of the sheet when pulled down (handle + a sliver of content). */
const PEEK_PX = 84
const SNAP = { type: 'spring', stiffness: 420, damping: 42 } as const

function screenFor(status: RideStatus): ReactNode {
  switch (status) {
    case 'processing':
      return <ProcessingScreen />
    case 'disambiguating':
      return <DisambiguationScreen />
    case 'confirming':
      return <ConfirmScreen />
    case 'dispatched':
      return <DispatchedScreen />
    default:
      // idle, recording and error share the home screen
      return <HomeScreen />
  }
}

/** Full-screen map with the current screen in a bottom sheet the user can pull down. */
export default function App() {
  const status = useRideStore((s) => s.status)
  const pickup = useRideStore((s) => s.pickup)
  const dropoff = useRideStore((s) => s.dropoff)
  const route = useRideStore((s) => s.route)
  const t = useT()
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)

  const sheetRef = useRef<HTMLElement>(null)
  const [sheetHeight, setSheetHeight] = useState(0)
  // Collapsed only for the status it was collapsed in — any new step re-opens the sheet.
  const [collapsedIn, setCollapsedIn] = useState<RideStatus | null>(null)
  const collapsed = collapsedIn === status
  const y = useMotionValue(0)
  const dragControls = useDragControls()
  const justDragged = useRef(false) // the click after a drag must not toggle again

  const maxOffset = Math.max(0, sheetHeight - PEEK_PX)
  const offset = collapsed ? maxOffset : 0

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSheetHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const controls = animate(y, offset, SNAP)
    return () => controls.stop()
  }, [y, offset])

  const setCollapsed = (value: boolean) => setCollapsedIn(value ? status : null)

  const onDragEnd = (_: unknown, info: PanInfo) => {
    justDragged.current = true
    const pulledDown = info.offset.y > 60 || info.velocity.y > 400
    const pulledUp = info.offset.y < -60 || info.velocity.y < -400
    const next = pulledDown ? true : pulledUp ? false : collapsed
    if (next === collapsed) animate(y, offset, SNAP) // snap back
    else setCollapsed(next)
  }

  // idle / recording / error share the home screen, so don't re-animate between them.
  const key = ['idle', 'recording', 'error'].includes(status) ? 'home' : status

  return (
    <div className="relative mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-bg">
      <div className="absolute inset-0 isolate">
        <MapPreview
          pickup={pickup}
          dropoff={dropoff}
          geometry={route?.geometry ?? null}
          bottomInset={collapsed ? PEEK_PX : sheetHeight}
          // Opposite corner from the logo (logo sits at the start edge).
          attributionPosition={lang === 'ar' ? 'topleft' : 'topright'}
        />
        <header className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-center gap-2 p-3">
          <div className="flex items-center rounded-2xl bg-surface/95 px-3 py-2 shadow-md ring-1 ring-border backdrop-blur">
            <img src="/petra-ride-logo.png" alt="Petra Ride" className="h-7 w-auto" />
          </div>
          {/* AR / EN switch — UI language only; the API contract is unchanged. */}
          <div
            role="group"
            aria-label={t.switchLang}
            className="pointer-events-auto flex rounded-full bg-surface/95 p-1 shadow-md ring-1 ring-border backdrop-blur"
          >
            {(['ar', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                lang={code}
                className={`min-h-9 min-w-11 rounded-full px-2.5 text-xs font-bold transition ${
                  lang === code ? 'bg-accent text-accent-ink' : 'text-muted hover:text-fg'
                }`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </header>
      </div>

      <motion.section
        ref={sheetRef}
        aria-label={t.sheetLabel}
        style={{ y }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: maxOffset }}
        dragElastic={0.08}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        className="absolute inset-x-0 bottom-0 z-10 flex max-h-[78%] flex-col rounded-t-3xl bg-bg shadow-[0_-8px_24px_rgb(15_23_42/0.12)]"
      >
        {/* Drag handle: pull down to see the whole map, up (or tap) to bring the sheet back. */}
        <button
          type="button"
          onPointerDown={(e) => {
            justDragged.current = false
            dragControls.start(e)
          }}
          onClick={() => {
            if (!justDragged.current) setCollapsed(!collapsed)
          }}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.sheetShow : t.sheetHide}
          className="flex h-8 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <span className="h-1.5 w-12 rounded-full bg-slate-300" />
        </button>

        <div
          className={`min-h-0 flex-1 overscroll-contain [scrollbar-color:var(--pv-border)_transparent] [scrollbar-width:thin] ${
            collapsed ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
          inert={collapsed}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {screenFor(status)}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.section>
    </div>
  )
}
