import { config } from '../config.ts'
import type { Route } from '../contract.ts'

// OSRM driving route. Only the backend calls OSRM (contract rule). Any failure → null,
// and the frontend draws a straight dashed line instead — the demo must never break.

/** OSRM's durations assume empty roads; Amman traffic is slower. */
const TRAFFIC_FACTOR = 1.35
const TIMEOUT_MS = 5000

const cache = new Map<string, Route>()

export async function fetchRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<Route | null> {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const hit = cache.get(coords)
  if (hit) return hit

  try {
    const url = `${config.osrmUrl}/route/v1/driving/${coords}?overview=full&geometries=polyline`
    const res = await fetch(url, {
      headers: { 'User-Agent': config.userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as {
      code: string
      routes?: { geometry: string; distance: number; duration: number }[]
    }
    const r = body.routes?.[0]
    if (body.code !== 'Ok' || !r) throw new Error(`OSRM code ${body.code}`)

    const route: Route = {
      distanceKm: Math.round(r.distance / 100) / 10,
      durationMinutes: Math.max(1, Math.round((r.duration / 60) * TRAFFIC_FACTOR)),
      geometry: r.geometry, // encoded polyline, precision 5 (OSRM default)
    }
    cache.set(coords, route)
    return route
  } catch (e) {
    console.warn('[routing] OSRM unavailable, returning route: null —', (e as Error).message)
    return null
  }
}
