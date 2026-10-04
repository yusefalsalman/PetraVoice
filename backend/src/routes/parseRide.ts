import { Router } from 'express'
import multer from 'multer'
import {
  type DisambiguationOption,
  type ParseRideSuccess,
  type Place,
} from '../contract.ts'
import { findGate, GATED_LANDMARKS } from '../data/geoKnowledge.ts'
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

/**
 * Gate / entrance notes ride along in `name` after « • » («مكة مول • بوابة 2») — the contract has
 * no notes field. The frontend splits on it to show the note under the landmark; confirm-ride
 * gets the full string so the driver sees the gate. (« - » is not used: real names contain it.)
 */
export const NOTES_SEPARATOR = ' • '

/** A known gate of a known landmark: exact road-side pin. */
const GATE_CONFIDENCE = 0.97

/**
 * Attaches the gate / entrance the rider named. For landmarks with mapped gates
 * (data/geoKnowledge.ts) the pin moves to that gate — «مكة مول • بوابة 2» at Gate 2, not the roof.
 * Otherwise the note rides along in the name at the landmark's own pin.
 */
function withGate(c: Candidate, detail: string | null, lang: Lang): Candidate {
  // Not on the current-location marker: the frontend recognises it by its exact name.
  if (!detail || c.source === 'current') return c
  const gated = c.landmarkId ? GATED_LANDMARKS[c.landmarkId] : undefined
  // Approximate matches (area fallbacks) keep their label: there's no sure landmark to gate.
  if (gated && c.confidence > 0.75) {
    const base = lang === 'en' ? gated.en : gated.ar
    const found = findGate(c.landmarkId!, detail)
    if (found) {
      const label = lang === 'en' ? found.gate.en : found.gate.ar
      console.log(`[gate] ${base} → ${found.gate.en} (${found.gate.lat}, ${found.gate.lng})`)
      return { ...c, name: `${base}${NOTES_SEPARATOR}${label}`, lat: found.gate.lat, lng: found.gate.lng, confidence: GATE_CONFIDENCE }
    }
    // Unmapped gate («بوابة الهندسة»): landmark pin, the rider's gate as the note.
    return { ...c, name: `${base}${NOTES_SEPARATOR}${detail}` }
  }
  if (c.name.includes(detail)) return c
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
    q ? `«${q.name}»${q.detail ? ` #${q.detail}` : ''}${q.area ? ` @${q.area}` : ''} [${q.candidates.join(' | ')}]` : '—'
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
  const pickup = pickupRes?.kind === 'found' ? withGate(pickupRes.place, ex.pickup?.detail ?? null, ex.language) : null
  const dropoff = dropoffRes?.kind === 'found' ? withGate(dropoffRes.place, ex.dropoff?.detail ?? null, ex.language) : null

  // 4. Ambiguous → the options for one field (dropoff first), no fare yet: two similar places, or up
  //    to five for a generic category («وصلني ع المستشفى»).
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
