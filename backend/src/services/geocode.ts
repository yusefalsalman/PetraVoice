import { config } from '../config.ts'
import { AMBIGUOUS_TERMS, CURRENT_LOCATION, CURRENT_LOCATION_PHRASES } from '../data/landmarks.ts'
import { db } from '../db/database.ts'
import { editDistance, normalizeArabic, straightLineKm } from '../lib/text.ts'

// Cascading geocoder: current-location phrases → local landmark KB (SQLite) → Nominatim.

export interface Candidate {
  name: string
  lat: number
  lng: number
  confidence: number
  source: 'current' | 'kb' | 'nominatim'
}

export type Resolution =
  | { kind: 'found'; place: Candidate }
  | { kind: 'ambiguous'; options: [Candidate, Candidate] }
  | { kind: 'not_found' }

/** Language of the rider's request — place names are returned in it. */
export type Lang = 'ar' | 'en'

// ---------------------------------------------------------------- Level 1: knowledge base

interface AliasRow {
  alias: string
  isPrimary: boolean
  id: string
  name: string
  nameEn: string | null
  lat: number
  lng: number
}

// Loaded once after seeding; longest aliases first so «الجامعة الأردنية» beats «الجامعة».
const ALIASES: AliasRow[] = (
  db
    .prepare(
      `SELECT a.alias, a.is_primary AS isPrimary, l.id, l.name, l.name_en AS nameEn, l.lat, l.lng
       FROM landmark_aliases a JOIN landmarks l ON l.id = a.landmark_id`,
    )
    .all() as unknown as (Omit<AliasRow, 'isPrimary'> & { isPrimary: number })[]
)
  .map((r) => ({ ...r, isPrimary: r.isPrimary === 1 }))
  .sort((a, b) => b.alias.length - a.alias.length)

const landmarkById = (id: string) => ALIASES.find((a) => a.id === id)!

const kbCandidate = (row: AliasRow, confidence: number, lang: Lang): Candidate => ({
  name: lang === 'en' ? (row.nameEn ?? row.name) : row.name,
  lat: row.lat,
  lng: row.lng,
  confidence,
  source: 'kb',
})

function resolveFromKnowledgeBase(q: string, lang: Lang): Resolution | null {
  const exact = ALIASES.find((a) => a.alias === q)
  if (exact) return { kind: 'found', place: kbCandidate(exact, exact.isPrimary ? 0.95 : 0.9, lang) }

  const generic = AMBIGUOUS_TERMS.find((g) => normalizeArabic(g.term) === q)
  if (generic) {
    const [a, b] = generic.ids.map(landmarkById)
    return { kind: 'ambiguous', options: [kbCandidate(a, 0.6, lang), kbCandidate(b, 0.6, lang)] }
  }

  // Typo-tolerant: «دوار الواهة» / "Mekka Mall" → canonical. Names ≥ 6 letters: 1 off; ≥ 9: 2 off.
  // Take the closest landmark; if two different ones are equally close («الثامن» vs «الخامس»), don't guess.
  if (q.length >= 6) {
    const max = q.length >= 9 ? 2 : 1
    let best: { row: AliasRow; d: number } | null = null
    let tie = false
    for (const a of ALIASES) {
      if (a.alias.length < 6) continue
      const d = editDistance(a.alias, q, max)
      if (d > max) continue
      if (!best || d < best.d) [best, tie] = [{ row: a, d }, false]
      else if (d === best.d && a.id !== best.row.id) tie = true
    }
    if (best && !tie) return { kind: 'found', place: kbCandidate(best.row, 0.9, lang) }
  }

  // "مستشفى الاستقلال البوابة الشرقية" → contains a known alias. Short aliases must be whole words.
  // But «مستشفى الجامعة الأردنية» is the university's *hospital*, not the university: if the
  // leftover words name another facility, it's a different place.
  const padded = ` ${q} `
  const contained = ALIASES.find((a) => {
    const inside = a.alias.length >= 5 ? q.includes(a.alias) : padded.includes(` ${a.alias} `)
    return inside && !FACILITY.test(q.replace(a.alias, ' '))
  })
  if (contained) return { kind: 'found', place: kbCandidate(contained, 0.85, lang) }

  return null
}

/** Words naming a distinct facility (normalised spelling: ة→ه, ى→ي). */
const FACILITY =
  /(?:^|\s)(?:مستشفي|مشفي|مدرسه|مسجد|جامع|مطعم|فندق|مركز|عياده|صيدليه|بنك|كليه|مكتبه|ملعب|hospital|school|mosque|restaurant|hotel|clinic|pharmacy|bank|college|library|stadium)(?:\s|$)/

// ---------------------------------------------------------------- Level 2: Nominatim

interface NominatimHit {
  name: string
  lat: number
  lng: number
  importance: number
  /** District / city, e.g. «الرمثا» — used to tell same-named places apart. */
  area?: string
}

/** «…, قضاء الرمثا, لواء الرمثا, إربد, الأردن» → «الرمثا»; "…, Ar-Ramtha District, Irbid, Jordan" → "Ar-Ramtha". */
function areaOf(displayName: string): string | undefined {
  const parts = displayName.split(',').map((p) => p.trim())
  const district = parts.find((p) => p.startsWith('لواء '))
  if (district) return district.replace(/^لواء\s+/, '').replace(/^قصبة\s+/, '')
  const englishDistrict = parts.find((p) => / District$/i.test(p) && !/Sub-District$/i.test(p))
  if (englishDistrict) return englishDistrict.replace(/ District$/i, '').replace(/^Qasabet\s+/i, '')
  return parts.find((p) => p.startsWith('محافظة '))?.replace(/^محافظة\s+/, '') ?? parts[parts.length - 2]
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const cacheGet = db.prepare('SELECT results, created_at AS createdAt FROM geocode_cache WHERE query = ?')
const cachePut = db.prepare('INSERT OR REPLACE INTO geocode_cache (query, results, created_at) VALUES (?, ?, ?)')

// Nominatim's usage policy: max 1 request per second.
let nextSlot = 0
async function politeFetch(url: string): Promise<Response> {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + 1100
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  return fetch(url, {
    headers: { 'User-Agent': config.userAgent, 'Accept-Language': 'ar,en' },
    signal: AbortSignal.timeout(6000),
  })
}

async function searchNominatim(query: string, lang: Lang): Promise<NominatimHit[]> {
  // Names come back in the request's language, so cache per language.
  const key = `${lang}:${normalizeArabic(query)}`
  const cached = cacheGet.get(key) as { results: string; createdAt: number } | undefined
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return JSON.parse(cached.results) as NominatimHit[]

  const params = new URLSearchParams({
    q: query,
    countrycodes: 'jo',
    format: 'json',
    limit: '3',
    'accept-language': lang,
    // Prefer Amman without excluding the rest of Jordan.
    viewbox: '35.70,32.15,36.10,31.70',
    bounded: '0',
  })
  const res = await politeFetch(`${config.nominatimUrl}/search?${params}`)
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)
  const raw = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string; importance?: number }[]

  const hits: NominatimHit[] = []
  for (const r of raw) {
    const hit = {
      name: r.name?.trim() || r.display_name.split(',')[0].trim(),
      lat: Number(r.lat),
      lng: Number(r.lon),
      importance: r.importance ?? 0,
      area: areaOf(r.display_name),
    }
    // Drop near-duplicates (same place mapped twice, e.g. building + entrance).
    if (!hits.some((h) => straightLineKm(h, hit) < 1)) hits.push(hit)
  }
  cachePut.run(key, JSON.stringify(hits), Date.now())
  return hits
}

interface NominatimOptions {
  confidence: number
  /** Only the rider's own wording may trigger «قصدك؟»; fallback queries take the best hit. */
  allowAmbiguous: boolean
  lang: Lang
}

async function resolveFromNominatim(query: string, opts: NominatimOptions): Promise<Resolution> {
  let hits: NominatimHit[]
  try {
    hits = await searchNominatim(query, opts.lang)
  } catch (e) {
    console.warn(`[geocode] Nominatim failed for «${query}»:`, (e as Error).message)
    return { kind: 'not_found' }
  }
  if (hits.length === 0) return { kind: 'not_found' }

  const toCandidate = (h: NominatimHit, confidence: number): Candidate => ({
    name: h.name,
    lat: h.lat,
    lng: h.lng,
    confidence,
    source: 'nominatim',
  })
  const [first, second] = hits
  // Two distinct places of similar prominence → ask the rider. Same name? Add the area.
  if (opts.allowAmbiguous && second && second.importance >= first.importance * 0.8) {
    const label = (h: NominatimHit) =>
      first.name === second.name && h.area && h.area !== h.name ? { ...h, name: `${h.name} - ${h.area}` } : h
    return { kind: 'ambiguous', options: [toCandidate(label(first), 0.6), toCandidate(label(second), 0.6)] }
  }
  return { kind: 'found', place: toCandidate(first, opts.confidence) }
}

// ---------------------------------------------------------------- Level 3b: Photon (fuzzy)

// Photon (komoot) searches the same OSM data with typo tolerance. It has no country filter,
// so results are limited to Jordan by bounding box AND country code — «عمان» is also Oman.
const JORDAN_BBOX = '34.9,29.1,39.4,33.4'

async function searchPhoton(query: string, lang: Lang): Promise<NominatimHit[]> {
  const key = `photon:${lang}:${normalizeArabic(query)}`
  const cached = cacheGet.get(key) as { results: string; createdAt: number } | undefined
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return JSON.parse(cached.results) as NominatimHit[]

  const params = new URLSearchParams({ q: query, lat: '31.95', lon: '35.93', limit: '5', bbox: JORDAN_BBOX })
  if (lang === 'en') params.set('lang', 'en') // Photon has no Arabic option; default = local names
  const res = await fetch(`${config.photonUrl}/api/?${params}`, {
    headers: { 'User-Agent': config.userAgent },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`)
  const body = (await res.json()) as {
    features: {
      geometry: { coordinates: [number, number] }
      properties: { name?: string; countrycode?: string; city?: string; district?: string; county?: string }
    }[]
  }
  const hits: NominatimHit[] = body.features
    .filter((f) => f.properties.countrycode === 'JO' && f.properties.name)
    .map((f) => ({
      name: f.properties.name!.trim(),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      importance: 0,
      area: f.properties.city ?? f.properties.district ?? f.properties.county,
    }))
  cachePut.run(key, JSON.stringify(hits), Date.now())
  return hits
}

/** Words that don't identify a place on their own (types, cities) — sharing one isn't a match. */
const STOP_WORDS = new Set(
  [
    'دوار', 'ميدان', 'شارع', 'مستشفي', 'مستشفى', 'مدرسه', 'جامعه', 'مول', 'مجمع', 'فندق', 'مطعم', 'مسجد', 'مركز', 'عمان', 'الاردن',
    'circle', 'roundabout', 'street', 'hospital', 'university', 'mall', 'hotel', 'restaurant', 'mosque', 'center', 'centre',
    'amman', 'jordan', 'the', 'of', 'and',
  ].map(normalizeArabic),
)
const significantTokens = (s: string) =>
  normalizeArabic(s)
    .split(' ')
    .map((w) => w.replace(/^ال/, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !STOP_WORDS.has(`ال${w}`))

/** Fuzzy hits must share a real word with what the rider asked for. */
function sharesWord(query: string, hitName: string): boolean {
  const hit = new Set(significantTokens(hitName))
  return significantTokens(query).some((t) => hit.has(t))
}

// ---------------------------------------------------------------- Public

export const currentLocation = (): Candidate => ({ ...CURRENT_LOCATION, confidence: 1, source: 'current' })

const CURRENT_PHRASES = CURRENT_LOCATION_PHRASES.map(normalizeArabic)

/** What the NLU step knows about one end of the trip. */
export interface PlaceQuery {
  /** Cleaned, typo-corrected name as the rider meant it, e.g. «مستشفى الأمير فيصل». */
  name: string
  /** Gate / entrance, e.g. «البوابة الشمالية». */
  detail: string | null
  /** Search queries, most specific first, e.g. ["مستشفى الامير فيصل الزرقاء", …]. */
  candidates: string[]
  /** Neighbourhood / district to fall back to, e.g. «مرج الحمام». */
  area: string | null
}

// Confidence by how the place was found. Nothing found by the cascade goes below 0.75,
// the contract's "must ask" threshold: the approximate area fallback sits exactly on it.
const CONFIDENCE = { spoken: 0.85, candidate: 0.8, variant: 0.78, fuzzy: 0.76, area: 0.75 }

/** Nominatim calls per side of the trip (1 req/s policy — keep worst-case latency bounded). */
const MAX_NOMINATIM_QUERIES = 6

const PREFIX = /^(?:دوار|ميدان|مستشفى|مستشفي|شارع|مجمع|مطعم|مول|مدرسة|مدرسه|اشارة|إشارة|جسر|نفق)\s+/
/** "Rainbow Street" → "Rainbow", "7th Circle" → "7th" (English counterpart of PREFIX). */
const ENGLISH_SUFFIX = /\s+(?:circle|roundabout|hospital|street|st|mall|square)$/i
const hasArabic = (s: string) => /[؀-ۿ]/.test(s)
const uniqueBy = (list: string[]) => {
  const seen = new Set<string>()
  return list.filter((x) => {
    const k = normalizeArabic(x)
    if (!x.trim() || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** A match further than this from the area the rider named («في مرج الحمام») is a different place. */
const AREA_RADIUS_KM = 12

/**
 * Cascading resolver:
 *  L1 local landmark KB (spoken name + candidates) →
 *  L2 Nominatim with the NLU's candidate queries, in order →
 *  L3 keyword stripping / city context («دوار» dropped, «عمان» appended) →
 *  L4 the broader area centre, flagged as approximate.
 * When the rider named an area, matches outside it are skipped, and a match that is
 * just the area itself is labelled approximate rather than passed off as exact.
 */
export async function resolvePlace(q: PlaceQuery, lang: Lang = 'ar'): Promise<Resolution> {
  const spoken = normalizeArabic(q.name)
  if (!spoken) return { kind: 'not_found' }
  if (CURRENT_PHRASES.includes(spoken) || spoken === normalizeArabic(CURRENT_LOCATION.name)) {
    return { kind: 'found', place: currentLocation() }
  }

  const queries = uniqueBy([q.name, ...q.candidates])

  let budget = MAX_NOMINATIM_QUERIES
  const tryNominatim = async (name: string, confidence: number, allowAmbiguous = false) => {
    if (budget <= 0) return null
    budget--
    const r = await resolveFromNominatim(name, { confidence, allowAmbiguous, lang })
    if (r.kind === 'not_found') return null
    // OSM may only have the name in the other language — show the rider's own wording instead.
    if (r.kind === 'found' && hasArabic(r.place.name) !== (lang === 'ar')) {
      return { ...r, place: { ...r.place, name: q.name } }
    }
    return r
  }

  // Centre of the area the rider mentioned — looked up once, only when needed.
  let areaCenter: Candidate | null | undefined
  const getAreaCenter = async (): Promise<Candidate | null> => {
    if (areaCenter !== undefined) return areaCenter
    areaCenter = null
    if (!q.area) return null
    const r =
      resolveFromKnowledgeBase(normalizeArabic(q.area), lang) ??
      (await tryNominatim(`${q.area} ${lang === 'en' ? 'Jordan' : 'الأردن'}`, CONFIDENCE.area)) ??
      (await tryNominatim(q.area, CONFIDENCE.area))
    if (r?.kind === 'found') areaCenter = r.place
    return areaCenter
  }
  const inArea = async (c: Candidate) => {
    const center = await getAreaCenter()
    return !center || straightLineKm(center, c) <= AREA_RADIUS_KM
  }

  const approximate = (c: Candidate): Candidate => ({
    ...c,
    name: `${q.name} (${q.area ?? c.name} - ${lang === 'en' ? 'approximate' : 'موقع تقريبي'})`,
    confidence: CONFIDENCE.area,
  })
  // The hit is the neighbourhood itself (e.g. «جبل اللويبدة» for «دوار باريس»), not the landmark.
  const core = normalizeArabic(q.name.replace(PREFIX, ''))
  const isAreaLevel = (c: Candidate) => {
    const hit = normalizeArabic(c.name)
    const area = normalizeArabic(q.area ?? '')
    return Boolean(area) && (hit.includes(area) || area.includes(hit)) && !hit.includes(core)
  }

  const accept = async (r: Resolution): Promise<Resolution | null> => {
    if (r.kind === 'ambiguous') {
      // If the rider named an area, it usually settles which of the two they meant.
      if (!q.area) return r
      const fits = []
      for (const o of r.options) if (await inArea(o)) fits.push(o)
      if (fits.length === 1) return { kind: 'found', place: { ...fits[0], confidence: CONFIDENCE.candidate } }
      return fits.length === 2 ? r : null
    }
    if (r.kind !== 'found' || !(await inArea(r.place))) return null
    return isAreaLevel(r.place) ? { kind: 'found', place: approximate(r.place) } : r
  }

  // L1 — local landmark KB, instant. Only trusted for the rider's own name, or for candidates
  // that share a real word with it. A candidate that is just the surrounding area («العبدلي عمان»
  // for "Kempinski Hotel") is kept as a last-resort approximate answer, after real searches.
  let areaFallback: Candidate | null = null
  for (const [i, name] of queries.entries()) {
    const local = resolveFromKnowledgeBase(normalizeArabic(name), lang)
    if (!local) continue
    const trusted = i === 0 || sharesWord(name, q.name)
    if (local.kind === 'found' && (!trusted || isAreaLevel(local.place))) {
      areaFallback ??= local.place
      continue
    }
    return local
  }

  // L2 — the rider's words, then the NLU's candidates.
  for (const [i, name] of queries.entries()) {
    const r = await tryNominatim(name, i === 0 ? CONFIDENCE.spoken : CONFIDENCE.candidate, i === 0)
    const ok = r && (await accept(r))
    if (ok) return ok
  }

  // L3 — strip the landmark type / add city context.
  const stripped = q.name.replace(PREFIX, '').replace(ENGLISH_SUFFIX, '').trim()
  const city = q.area ?? (lang === 'en' ? 'Amman' : 'عمان')
  const country = lang === 'en' ? 'Jordan' : 'الأردن'
  const variants = uniqueBy([`${q.name} ${city}`, `${stripped} ${city}`, `${q.name} ${country}`]).filter(
    (v) => !queries.some((x) => normalizeArabic(x) === normalizeArabic(v)),
  )
  for (const v of variants) {
    const r = await tryNominatim(v, CONFIDENCE.variant)
    const ok = r && (await accept(r))
    if (ok?.kind === 'found') {
      return ok.place.confidence === CONFIDENCE.area ? ok : { kind: 'found', place: { ...ok.place, name: q.name } }
    }
  }

  // L3b — Photon fuzzy search over every query in parallel (it has no 1 req/s policy like
  // Nominatim); take the first, in priority order, that is in Jordan, in the rider's area and
  // shares a real word with what they asked for.
  const photonHits = await Promise.all(
    queries.slice(0, 4).map((name) =>
      searchPhoton(name, lang).catch((e: Error) => {
        console.warn(`[geocode] Photon failed for «${name}»:`, e.message)
        return [] as NominatimHit[]
      }),
    ),
  )
  for (const [i, hits] of photonHits.entries()) {
    for (const h of hits) {
      if (!sharesWord(queries[i], h.name)) continue
      const named = hasArabic(h.name) === (lang === 'ar') ? h.name : q.name
      const ok = await accept({
        kind: 'found',
        place: { name: named, lat: h.lat, lng: h.lng, confidence: CONFIDENCE.fuzzy, source: 'nominatim' },
      })
      if (ok) return ok
    }
  }

  // L4 — broader area centre, clearly labelled as approximate.
  if (areaFallback) return { kind: 'found', place: approximate(areaFallback) }
  const center = await getAreaCenter()
  if (center) return { kind: 'found', place: approximate(center) }
  return { kind: 'not_found' }
}

/** Canonical landmark names + aliases, used to steer Whisper and the LLM toward local spellings. */
export const knownPlaceNames = (): string[] => [...new Set(ALIASES.map((a) => a.name))]
