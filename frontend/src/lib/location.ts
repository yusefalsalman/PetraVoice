/**
 * The rider's default pickup when they don't name one ("current location").
 * Fixed to central Amman (دوار الداخلية) for the demo — no GPS prompt.
 * The name is sent as-is in /api/confirm-ride; the UI shows a translated label instead.
 */
export const CURRENT_LOCATION = { name: 'موقعي الحالي (عمان)', lat: 31.9725, lng: 35.9098 } as const

export const isCurrentLocation = (name: string | undefined) => name === CURRENT_LOCATION.name

/** Straight-line distance in km (haversine) — only for fare estimates when there is no route. */
export function straightLineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
