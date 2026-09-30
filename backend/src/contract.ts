// Mirrors the API contract in ../CLAUDE.md exactly (same as frontend/src/types/api.ts).
// Do not rename or add response fields without agreeing a contract change.

export type RideType = 'economy' | 'comfort' | 'xl'
export const RIDE_TYPES: readonly RideType[] = ['economy', 'comfort', 'xl']

export type ApiErrorCode = 'STT_FAILED' | 'NO_LOCATION_FOUND' | 'INVALID_AUDIO' | 'SERVER_ERROR'

export interface Place {
  name: string
  lat: number
  lng: number
  confidence: number
}

export interface FareEstimate {
  min: number
  max: number
  currency: 'JOD'
}

export interface Route {
  distanceKm: number
  durationMinutes: number
  /** OSRM encoded polyline, precision 5 */
  geometry: string
}

export interface DisambiguationOption {
  field: 'pickup' | 'dropoff'
  name: string
  lat: number
  lng: number
}

export interface ParseRideSuccess {
  success: true
  transcript: string
  pickup: Place | null
  dropoff: Place | null
  rideType: RideType
  fareEstimate: FareEstimate | null
  route?: Route | null
  needsDisambiguation: boolean
  options: DisambiguationOption[]
}

export interface LatLngName {
  name: string
  lat: number
  lng: number
}

export interface ConfirmRideRequest {
  pickup: LatLngName
  dropoff: LatLngName
  rideType: RideType
}

export interface ConfirmRideSuccess {
  success: true
  bookingId: string
  status: 'dispatched'
  etaMinutes: number
}

/** Below this the backend must ask the rider to choose (contract rule). */
export const MIN_CONFIDENCE = 0.75
