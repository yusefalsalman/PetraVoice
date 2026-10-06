/**
 * The rider's default pickup when they don't name one ("current location") and the phone gave no
 * GPS fix: central Amman (دوار الداخلية). With a fix the backend answers «موقعي الحالي» at the
 * phone's position instead. The UI shows a translated label for either.
 */
export const CURRENT_LOCATION = { name: 'موقعي الحالي (عمان)', lat: 31.9725, lng: 35.9098 } as const

export const isCurrentLocation = (name: string | undefined) => !!name?.startsWith('موقعي الحالي')

let here: { lat: number; lng: number } | null = null
let locating: Promise<{ lat: number; lng: number } | null> | null = null

/**
 * The phone's position for «من بيتي» / «من موقعي» / no pickup said. Asks once (the browser shows
 * its own permission prompt — HTTPS or localhost only), then reuses the fix. Never throws:
 * null when refused or unavailable, and the backend falls back to the fixed Amman point.
 */
export function locateRider(): Promise<{ lat: number; lng: number } | null> {
  if (here) return Promise.resolve(here)
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  locating ??= new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        here = { lat: p.coords.latitude, lng: p.coords.longitude }
        resolve(here)
      },
      () => {
        locating = null // refused or timed out — a later request may ask again
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    ),
  )
  return locating
}

/** The last GPS fix, if any. */
export const riderPosition = () => here

/**
 * The backend appends gate / entrance notes to `name` after « • » («مكة مول • بوابة 2») — the
 * contract has no notes field. Split them so the UI can show the landmark and the note apart.
 */
export const NOTES_SEPARATOR = ' • '

export function splitNotes(name: string): { main: string; notes: string | null } {
  const at = name.indexOf(NOTES_SEPARATOR)
  return at < 0 ? { main: name, notes: null } : { main: name.slice(0, at), notes: name.slice(at + NOTES_SEPARATOR.length) }
}

/** Straight-line distance in km (haversine) — only for fare estimates when there is no route. */
export function straightLineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
