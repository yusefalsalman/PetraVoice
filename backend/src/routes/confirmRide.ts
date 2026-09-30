import { Router } from 'express'
import { RIDE_TYPES, type ConfirmRideSuccess, type LatLngName, type RideType } from '../contract.ts'
import { db } from '../db/database.ts'
import { ApiError } from '../errors.ts'

// POST /api/confirm-ride — the only way a ride gets booked, after the rider confirmed on screen.

const isPoint = (v: unknown): v is LatLngName => {
  const p = v as LatLngName | null
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0 &&
    p.name.length <= 200 &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  )
}

const insertBooking = db.prepare(
  `INSERT INTO bookings (pickup_json, dropoff_json, ride_type, status, eta_minutes, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
)
const setBookingId = db.prepare('UPDATE bookings SET booking_id = ? WHERE id = ?')

export const confirmRideRouter = Router()

confirmRideRouter.post('/confirm-ride', (req, res) => {
  const { pickup, dropoff, rideType } = (req.body ?? {}) as Record<string, unknown>
  if (!isPoint(pickup) || !isPoint(dropoff) || !RIDE_TYPES.includes(rideType as RideType)) {
    // The contract has no validation code; SERVER_ERROR with a clear Arabic message.
    throw new ApiError('SERVER_ERROR', 'بيانات الحجز غير مكتملة، حاول مرة أخرى', 400)
  }

  // Simulated dispatch: nearest driver 3–7 minutes away.
  const etaMinutes = 3 + Math.floor(Math.random() * 5)
  const now = new Date()
  const point = (p: LatLngName) => JSON.stringify({ name: p.name.trim(), lat: p.lat, lng: p.lng })
  const { lastInsertRowid } = insertBooking.run(
    point(pickup),
    point(dropoff),
    rideType as string,
    'dispatched',
    etaMinutes,
    now.toISOString(),
  )
  const bookingId = `PV-${now.getFullYear()}-${String(lastInsertRowid).padStart(5, '0')}`
  setBookingId.run(bookingId, lastInsertRowid)

  const body: ConfirmRideSuccess = { success: true, bookingId, status: 'dispatched', etaMinutes }
  res.json(body)
})
