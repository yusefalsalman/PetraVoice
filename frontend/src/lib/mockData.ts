import polyline from '@mapbox/polyline'
import { fareForTier } from './fare'
import { CURRENT_LOCATION } from './location'
import type {
  ApiError,
  ConfirmRideSuccess,
  DisambiguationOption,
  ParseRideResponse,
  ParseRideSuccess,
  Place,
  RideType,
  Route,
} from '../types/api'

// ---------------------------------------------------------------------------
// Mock-mode stand-in for the backend: a tiny landmark list of real Amman places
// (coordinates from OpenStreetMap) and real OSRM routes precomputed per pair in
// mockRoutes.json. Only used when VITE_USE_MOCK=true.
// ---------------------------------------------------------------------------

interface Landmark {
  id: string
  name: string
  aliases: string[]
  lat: number
  lng: number
}

// Order matters: mockRoutes.json keys are `${a}|${b}` with a before b in this list.
const LANDMARKS: Landmark[] = [
  { id: 'waha', name: 'دوار الواحة', aliases: ['الواحة'], lat: 31.9871, lng: 35.8712 },
  { id: 'istiklal', name: 'مستشفى الاستقلال', aliases: ['الاستقلال'], lat: 31.9945, lng: 35.9102 },
  { id: 'ju', name: 'الجامعة الأردنية - البوابة الشمالية', aliases: ['الجامعة الأردنية', 'الأردنية'], lat: 32.0141, lng: 35.8701 },
  { id: 'asu', name: 'جامعة العلوم التطبيقية', aliases: ['العلوم التطبيقية', 'التطبيقية'], lat: 32.0318, lng: 35.8794 },
  { id: 'interior', name: 'دوار الداخلية', aliases: ['الداخلية'], lat: 31.9725, lng: 35.9098 },
  { id: 'abdali', name: 'العبدلي بوليفارد', aliases: ['العبدلي', 'البوليفارد', 'بوليفارد'], lat: 31.9649, lng: 35.9041 },
  { id: 'citymall', name: 'سيتي مول', aliases: ['city mall'], lat: 31.9805, lng: 35.838 },
  { id: 'mecca', name: 'مكة مول', aliases: ['mecca mall'], lat: 31.9777, lng: 35.8439 },
  { id: 'taj', name: 'تاج مول', aliases: ['taj mall'], lat: 31.9412, lng: 35.8881 },
  { id: 'seventh', name: 'الدوار السابع', aliases: ['السابع'], lat: 31.9594, lng: 35.8576 },
  { id: 'roman', name: 'المدرج الروماني - وسط البلد', aliases: ['المدرج الروماني', 'وسط البلد', 'البلد', 'downtown'], lat: 31.9516, lng: 35.9393 },
  { id: 'airport', name: 'مطار الملكة علياء الدولي', aliases: ['مطار الملكة علياء', 'المطار', 'airport'], lat: 31.7238, lng: 36.0072 },
  { id: 'sports', name: 'دوار المدينة الرياضية', aliases: ['المدينة الرياضية'], lat: 31.9854, lng: 35.8976 },
  { id: 'jordanhosp', name: 'مستشفى الأردن', aliases: [], lat: 31.9606, lng: 35.8997 },
  { id: 'rainbow', name: 'شارع الرينبو', aliases: ['الرينبو', 'rainbow'], lat: 31.9493, lng: 35.9303 },
  { id: 'abdoun', name: 'دوار عبدون', aliases: ['عبدون'], lat: 31.9488, lng: 35.8925 },
  { id: 'shmeisani', name: 'الشميساني', aliases: [], lat: 31.9735, lng: 35.8969 },
]

/** Vague words that match more than one landmark → the "قصدك؟" screen. */
const GENERIC: { term: string; ids: string[] }[] = [
  { term: 'الجامعة', ids: ['ju', 'asu'] },
  { term: 'المول', ids: ['citymall', 'mecca'] },
]

const byId = (id: string) => LANDMARKS.find((l) => l.id === id)!

/** Normalises Arabic spelling variants so «الاردنيه» matches «الأردنية». */
const norm = (s: string) =>
  s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()

interface Hit {
  start: number
  end: number
  landmark?: Landmark
  generic?: string[]
  exact: boolean
}

function findHits(text: string): Hit[] {
  const t = norm(text)
  const candidates: Hit[] = []
  const scan = (term: string, hit: Omit<Hit, 'start' | 'end'>) => {
    const n = norm(term)
    for (let at = t.indexOf(n); at !== -1; at = t.indexOf(n, at + 1)) {
      candidates.push({ ...hit, start: at, end: at + n.length })
    }
  }
  for (const lm of LANDMARKS) [lm.name, ...lm.aliases].forEach((a, i) => scan(a, { landmark: lm, exact: i === 0 }))
  for (const g of GENERIC) scan(g.term, { generic: g.ids, exact: false })

  // Longest match wins; drop overlaps and repeats of the same landmark.
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start))
  const kept: Hit[] = []
  for (const c of candidates) {
    const overlaps = kept.some((k) => c.start < k.end && k.start < c.end)
    const repeat = c.landmark && kept.some((k) => k.landmark === c.landmark)
    if (!overlaps && !repeat) kept.push(c)
  }
  return kept.sort((a, b) => a.start - b.start)
}

/** True when the words right before the match are «من» — i.e. it's the pickup. */
const isFrom = (text: string, hit: Hit) => /(^|\s)من\s*$/.test(norm(text).slice(0, hit.start))

function detectRideType(text: string): RideType {
  const t = norm(text)
  if (/xl|عائلي|كبيره|فان/.test(t)) return 'xl'
  if (/مريح|كومفورت|comfort/.test(t)) return 'comfort'
  return 'economy'
}

async function lookupRoute(a: Landmark, b: Landmark): Promise<Route | null> {
  const routes = (await import('./mockRoutes.json')).default as Record<string, { g: string; km: number; min: number }>
  const forward = routes[`${a.id}|${b.id}`]
  const r = forward ?? routes[`${b.id}|${a.id}`]
  if (!r) return null
  // Stored one way only — reverse the line for the opposite direction.
  const geometry = forward ? r.g : polyline.encode(polyline.decode(r.g, 5).reverse(), 5)
  return { distanceKm: r.km, durationMinutes: Math.max(3, Math.round(r.min * 1.4)), geometry }
}

export async function mockParseText(text: string): Promise<ParseRideResponse> {
  const hits = findHits(text).slice(0, 2)
  if (hits.length === 0) {
    return {
      success: false,
      error: { code: 'NO_LOCATION_FOUND', message: 'لم أتعرف على المكان. جرّب اسم معلم معروف مثل «العبدلي» أو «الدوار السابع».' },
    }
  }

  let pickupHit: Hit | undefined
  let dropoffHit: Hit | undefined
  if (hits.length === 2) {
    const swap = isFrom(text, hits[1]) && !isFrom(text, hits[0])
    ;[pickupHit, dropoffHit] = swap ? [hits[1], hits[0]] : hits
  } else if (isFrom(text, hits[0])) pickupHit = hits[0]
  else dropoffHit = hits[0]

  // «من X» / «إلى Y» was said but that part matched nothing → treat as not found.
  const t = norm(text)
  const saidTo = /(^|\s)(الي|علي)\s/.test(t)
  const saidFrom = /(^|\s)من\s/.test(t)
  if ((saidTo && !dropoffHit) || (saidFrom && !pickupHit)) {
    return {
      success: false,
      error: { code: 'NO_LOCATION_FOUND', message: 'لم أتعرف على أحد الموقعين. جرّب اسم معلم معروف قريب منه.' },
    }
  }

  const toPlace = (h?: Hit): Place | null =>
    h?.landmark ? { name: h.landmark.name, lat: h.landmark.lat, lng: h.landmark.lng, confidence: h.exact ? 0.95 : 0.87 } : null
  // Like the real backend: no pickup named → the rider's current location (central Amman).
  const pickup = pickupHit ? toPlace(pickupHit) : { ...CURRENT_LOCATION, confidence: 1 }
  const from = pickupHit ? pickupHit.landmark : byId('interior') // CURRENT_LOCATION's coordinates
  const dropoff = toPlace(dropoffHit)

  const options: DisambiguationOption[] = []
  for (const [field, h] of [['pickup', pickupHit], ['dropoff', dropoffHit]] as const) {
    h?.generic?.forEach((id) => options.push({ field, name: byId(id).name, lat: byId(id).lat, lng: byId(id).lng }))
  }
  const rideType = detectRideType(text)

  if (options.length > 0) {
    // Contract: exactly two options, one field at a time.
    return { success: true, transcript: text, pickup, dropoff, rideType, fareEstimate: null, needsDisambiguation: true, options: options.slice(0, 2) }
  }

  const route = from && dropoffHit?.landmark ? await lookupRoute(from, dropoffHit.landmark) : null
  return {
    success: true,
    transcript: text,
    pickup,
    dropoff,
    rideType,
    fareEstimate: fareForTier(rideType, null, 'economy', route?.distanceKm ?? null),
    route,
    needsDisambiguation: false,
    options: [],
  }
}

// ---- Fixed cases: audio in mock mode (no STT) and the ?mock= overrides ----

const WAHA_TO_ISTIKLAL = 'onfbEwa}yEYMm@[sAi@k@Wo@Wu@Y{@_@{@[OGQGc@QFYF]Jc@Lg@^uAHYJSL[Xm@`@y@d@cAn@mAd@}@Va@Ze@h@w@Ze@HMNSHMh@_A`@w@Vq@f@yAJ]H[`@}Ad@kBJc@H_@XkAZsAb@iB\\sBRsAn@iERsA^aCDWz@{Fb@gDVgB\\aC@ODYRiBR_DX}EH}@J_ABQL}@XaBXeBVwATmALi@DQDQDODQJ[Le@Pi@FQHSXu@N_@BKBM@Q?OESOUIEMEOCM@UFMHKFMDK?SGYU_@a@m@{@s@s@gCyCaCgDeDkE}@mBm@qAg@mAOc@i@_CMy@Iu@E{@Eu@AK?gA@oA@G@_@?ABeABm@@oADyBAc@Ce@Ek@Im@Ec@Ke@g@gBi@gBwAwEUq@Wo@a@}@CGKWACUc@o@qAIq@AK?M@MBKDKFIHGJCHCxAOHCHCJGzCEdAC~BK?UsBHoAD}CFq@Fk@F]D[H]J[PUNSPSPkBjBEBEBGBGGEECEEIUi@k@sAq@gBeAoCeIzEc@eAAOGMGIw@cAMIWa@a@o@KOEE[F_AXAbD'

export const mockSuccess: ParseRideSuccess = {
  success: true,
  transcript: 'وصلني من دوار الواحة لمستشفى الاستقلال',
  pickup: { name: 'دوار الواحة', lat: 31.9871, lng: 35.8712, confidence: 0.94 },
  dropoff: { name: 'مستشفى الاستقلال', lat: 31.9945, lng: 35.9102, confidence: 0.91 },
  rideType: 'economy',
  fareEstimate: { min: 2.5, max: 3.8, currency: 'JOD' },
  route: { distanceKm: 5.8, durationMinutes: 12, geometry: WAHA_TO_ISTIKLAL },
  needsDisambiguation: false,
  options: [],
}

export const mockAmbiguous: ParseRideSuccess = {
  success: true,
  transcript: 'وصلني من دوار الواحة على الجامعة',
  pickup: { name: 'دوار الواحة', lat: 31.9871, lng: 35.8712, confidence: 0.9 },
  dropoff: null,
  rideType: 'economy',
  fareEstimate: null,
  needsDisambiguation: true,
  options: [
    { field: 'dropoff', name: 'الجامعة الأردنية - البوابة الشمالية', lat: 32.0141, lng: 35.8701 },
    { field: 'dropoff', name: 'جامعة العلوم التطبيقية', lat: 32.0318, lng: 35.8794 },
  ],
}

export const mockError: ApiError = {
  success: false,
  error: { code: 'STT_FAILED', message: 'تعذر فهم الصوت، حاول مرة أخرى' },
}

export const mockConfirm: ConfirmRideSuccess = {
  success: true,
  bookingId: 'PV-2026-00123',
  status: 'dispatched',
  etaMinutes: 4,
}
