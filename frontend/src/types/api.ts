// Mirrors the API contract in ../CLAUDE.md exactly. Do not rename or add fields.

export type RideType = 'economy' | 'comfort' | 'xl'

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

export interface ApiError {
  success: false
  error: { code: ApiErrorCode; message: string }
}

export interface ParseRideSuccess {
  success: true
  transcript: string
  pickup: Place | null
  dropoff: Place | null
  rideType: RideType
  fareEstimate: FareEstimate | null
  /** Nullable: null when OSRM fails; absent in the ambiguous case. */
  route?: Route | null
  needsDisambiguation: boolean
  options: DisambiguationOption[]
}

export type ParseRideResponse = ParseRideSuccess | ApiError

export interface ParseRideInput {
  audio?: Blob
  text?: string
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

export type ConfirmRideResponse = ConfirmRideSuccess | ApiError
