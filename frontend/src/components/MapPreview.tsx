import polyline from '@mapbox/polyline'
import L from 'leaflet'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { AttributionControl, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'

type LatLng = [number, number]
interface Point {
  lat: number
  lng: number
}

const AMMAN: LatLng = [31.9539, 35.9106]
const AMMAN_BOUNDS: LatLng[] = [[31.935, 35.86], [31.99, 35.94]]
// SVG stroke attributes can't read CSS variables — keep in sync with index.css.
/** Petra Ride navy (--pv-accent) — Leaflet paths need a literal colour. */
const ROUTE_COLOR = '#00174b'

const pin = (kind: 'pickup' | 'dropoff') =>
  L.divIcon({
    className: '',
    html: `<div class="pv-pin pv-pin--${kind}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
const ICONS = { pickup: pin('pickup'), dropoff: pin('dropoff') }

/**
 * Keeps the view fitted to the given points inside the part of the map the bottom
 * sheet doesn't cover (`bottomInset` px). New routes are reached with a smooth
 * flyToBounds; the idle Amman view and window resizes snap instantly.
 */
function FitView({ points, bottomInset }: { points: LatLng[]; bottomInset: number }) {
  const map = useMap()
  const fitRef = useRef<(animate: boolean) => void>(() => {})

  // Latest fit function for the resize observer (kept current after every render).
  useLayoutEffect(() => {
    fitRef.current = (animate) => {
      const opts = {
        // Top padding clears the floating header; bottom padding clears the sheet.
        paddingTopLeft: [40, 72] as L.PointTuple,
        paddingBottomRight: [40, 32 + bottomInset] as L.PointTuple,
        maxZoom: points.length === 1 ? 15 : 16,
      }
      const target = points.length > 0 ? points : AMMAN_BOUNDS
      if (animate && points.length > 0) map.flyToBounds(target, { ...opts, duration: 1.2, easeLinearity: 0.2 })
      else map.fitBounds(target, { ...opts, animate: false })
    }
  })

  useEffect(() => {
    // A new result changes the points and the sheet height in quick succession —
    // wait a beat so they become one smooth flight instead of two jerky ones.
    const t = setTimeout(() => fitRef.current(true), 120)
    return () => clearTimeout(t)
  }, [map, points, bottomInset]) // `points` is memoized below

  useEffect(() => {
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Stop any flight first: invalidateSize() mid-animation corrupts Leaflet's view.
        map.stop()
        map.invalidateSize({ animate: false })
        fitRef.current(false)
      })
    })
    ro.observe(map.getContainer())
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [map])

  return null
}

interface Props {
  pickup: Point | null
  dropoff: Point | null
  /** OSRM encoded polyline (precision 5), or null to draw a straight dashed line. */
  geometry: string | null
  /** Height in px of the sheet covering the bottom of the map. */
  bottomInset: number
  attributionPosition: L.ControlPosition
}

export default function MapPreview({ pickup, dropoff, geometry, bottomInset, attributionPosition }: Props) {
  const line = useMemo<LatLng[] | null>(() => {
    if (geometry) return polyline.decode(geometry, 5) as LatLng[]
    if (pickup && dropoff) return [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]]
    return null
  }, [geometry, pickup, dropoff])

  const fitPoints = useMemo<LatLng[]>(() => {
    if (line) return line
    return [pickup, dropoff].filter((p): p is Point => !!p).map((p) => [p.lat, p.lng])
  }, [line, pickup, dropoff])

  return (
    <MapContainer
      center={AMMAN}
      zoom={12}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom={false}
      className="size-full"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {/* Keyed: Leaflet controls read their position only once. */}
      <AttributionControl key={attributionPosition} position={attributionPosition} prefix={false} />
      <FitView points={fitPoints} bottomInset={bottomInset} />

      {/* `key` forces a fresh layer whenever the geometry changes. */}
      {line && (
        <>
          <Polyline key={`casing-${geometry ?? 'straight'}`} positions={line} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
          <Polyline
            key={`line-${geometry ?? 'straight'}`}
            positions={line}
            pathOptions={{ color: ROUTE_COLOR, weight: 5, dashArray: geometry ? undefined : '8 10' }}
          />
        </>
      )}
      {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={ICONS.pickup} />}
      {dropoff && <Marker position={[dropoff.lat, dropoff.lng]} icon={ICONS.dropoff} />}
    </MapContainer>
  )
}
