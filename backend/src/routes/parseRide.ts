import { Router } from 'express'
import multer from 'multer'
import {
  type DisambiguationOption,
  type ParseRideSuccess,
  type Place,
} from '../contract.ts'
import { ApiError } from '../errors.ts'
import { straightLineKm } from '../lib/text.ts'
import { currentLocation, resolvePlace, type Candidate, type Lang, type PlaceQuery, type Resolution } from '../services/geocode.ts'
import { correctTranscript, extractRide } from '../services/nlu.ts'
import { fareFor } from '../services/pricing.ts'
import { fetchRoute } from '../services/routing.ts'
import { isSupportedAudio, transcribe } from '../services/stt.ts'

// POST /api/parse-ride — multipart: `audio` (webm/wav/mp4…) or `text`. Never books anything.

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
/** Straight lines are shorter than roads — used only when OSRM is unavailable. */
const ROAD_FACTOR = 1.3

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) =>
    isSupportedAudio(file.mimetype) ? cb(null, true) : cb(new ApiError('INVALID_AUDIO')),
})

const toPlace = (c: Candidate): Place => ({ name: c.name, lat: c.lat, lng: c.lng, confidence: c.confidence })

/** "الجامعة الأردنية" + "البوابة الشمالية" → one name, as in the contract's own example. */
/**
 * Gate / entrance notes ride along in `name` after « • » («مكة مول • بوابة 2») — the contract has
 * no notes field. The frontend splits on it to show the note under the landmark; confirm-ride
 * gets the full string so the driver sees the gate. (« - » is not used: real names contain it.)
 */
export const NOTES_SEPARATOR = ' • '

function withDetail(c: Candidate, detail: string | null): Candidate {
  // Not on the current-location marker: the frontend recognises it by its exact name.
  if (!detail || c.source === 'current' || c.name.includes(detail)) return c
  return { ...c, name: `${c.name}${NOTES_SEPARATOR}${detail}` }
}

async function resolveOrDefault(
  query: PlaceQuery | null,
  lang: Lang,
  fallback: () => Candidate | null,
): Promise<Resolution | null> {
  if (query) return resolvePlace(query, lang)
  const place = fallback()
  return place ? { kind: 'found', place } : null
}

export const parseRideRouter = Router()

parseRideRouter.post('/parse-ride', upload.single('audio'), async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''

  // 1. Transcript: `text` skips STT (contract).
  let transcript: string
  if (text) {
    transcript = text.slice(0, 500)
  } else if (req.file) {
    if (req.file.size === 0) throw new ApiError('INVALID_AUDIO')
    transcript = await transcribe(req.file.buffer, req.file.mimetype)
  } else {
    throw new ApiError('INVALID_AUDIO')
  }

  // 2. Who goes where (typo-corrected, with search candidates).
  // Known mishearings («ورد جندي» → «دوار الجندي») are fixed up front; the rider sees the corrected text.
  transcript = correctTranscript(transcript)
  const ex = await extractRide(transcript)
  const describe = (q: PlaceQuery | null) =>
    q ? `«${q.name}»${q.area ? ` @${q.area}` : ''} [${q.candidates.join(' | ')}]` : '—'
  console.log(`[nlu] ${ex.language} pickup=${describe(ex.pickup)} dropoff=${describe(ex.dropoff)}`)

  // 3. Geocode both ends in parallel through the cascade. No pickup said → current location.
  //    Location problems never fail the request: an unresolvable side comes back null and the
  //    app asks the rider to fill it in (confirm-ride still requires both).
  const [pickupRes, dropoffRes] = await Promise.all([
    resolveOrDefault(ex.pickup, ex.language, currentLocation),
    resolveOrDefault(ex.dropoff, ex.language, () => null),
  ])
  for (const [side, q, r] of [['pickup', ex.pickup, pickupRes], ['dropoff', ex.dropoff, dropoffRes]] as const) {
    if (q && r?.kind === 'not_found') console.warn(`[parse-ride] ${side} «${q.name}» not found at any level`)
  }

  const rideType = ex.rideType ?? 'economy'
  const pickup = pickupRes?.kind === 'found' ? withDetail(pickupRes.place, ex.pickup?.detail ?? null) : null
  const dropoff = dropoffRes?.kind === 'found' ? withDetail(dropoffRes.place, ex.dropoff?.detail ?? null) : null

  // 4. Ambiguous → exactly two options for one field (dropoff first), no fare yet.
  const ambiguous =
    dropoffRes?.kind === 'ambiguous'
      ? { field: 'dropoff' as const, options: dropoffRes.options }
      : pickupRes?.kind === 'ambiguous'
        ? { field: 'pickup' as const, options: pickupRes.options }
        : null
  // Contract: confidence < 0.75 must ask. The cascade never returns a found place below
  // 0.75 (approximate area centres sit exactly on it), so only real ambiguity asks.

  if (ambiguous) {
    const options: DisambiguationOption[] = ambiguous.options.map((o) => ({
      field: ambiguous.field,
      name: o.name,
      lat: o.lat,
      lng: o.lng,
    }))
    const body: ParseRideSuccess = {
      success: true,
      transcript,
      pickup: pickup && ambiguous.field !== 'pickup' ? toPlace(pickup) : null,
      dropoff: dropoff && ambiguous.field !== 'dropoff' ? toPlace(dropoff) : null,
      rideType,
      fareEstimate: null,
      needsDisambiguation: true,
      options,
    }
    res.json(body)
    return
  }

  // 5. Route + fare. OSRM down → route: null, fare from straight-line distance.
  const route = pickup && dropoff ? await fetchRoute(pickup, dropoff) : null
  const distanceKm =
    route?.distanceKm ?? (pickup && dropoff ? Math.round(straightLineKm(pickup, dropoff) * ROAD_FACTOR * 10) / 10 : null)

  const body: ParseRideSuccess = {
    success: true,
    transcript,
    pickup: pickup ? toPlace(pickup) : null,
    dropoff: dropoff ? toPlace(dropoff) : null,
    rideType,
    fareEstimate: distanceKm !== null ? fareFor(distanceKm, rideType) : null,
    route,
    needsDisambiguation: false,
    options: [],
  }
  res.json(body)
})
