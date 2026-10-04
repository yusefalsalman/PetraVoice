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
  /** Knowledge-base landmark id, when the place came from it — used to look up its gates. */
  landmarkId?: string
}

export type Resolution =
  | { kind: 'found'; place: Candidate }
  /** 2 for two similar map hits; up to 5 for a generic category («الجامعة», «المستشفى»). */
  | { kind: 'ambiguous'; options: Candidate[] }
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
  landmarkId: row.id,
})

function resolveFromKnowledgeBase(q: string, lang: Lang): Resolution | null {
  const exact = ALIASES.find((a) => a.alias === q)
  if (exact) return { kind: 'found', place: kbCandidate(exact, exact.isPrimary ? 0.95 : 0.9, lang) }

  const generic = AMBIGUOUS_TERMS.find((g) => normalizeArabic(g.term) === q)
  if (generic) {
    return { kind: 'ambiguous', options: generic.ids.map((id) => kbCandidate(landmarkById(id), 0.6, lang)) }
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
  // Several aliases inside («دوار الدلة مرج الحمام»)? The one said first is the place; later
  // ones are usually its area.
  const padded = ` ${q} `
  const position = (a: AliasRow) => (a.alias.length >= 5 ? q.indexOf(a.alias) : padded.indexOf(` ${a.alias} `))
  const contained = ALIASES.filter((a) => position(a) >= 0 && !FACILITY.test(q.replace(a.alias, ' '))).sort(
    (a, b) => position(a) - position(b) || b.alias.length - a.alias.length,
  )[0]
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

// Kinds of place. «حديقة بنك الإسكان» (a park) is not «مجمع بنك الإسكان» (an office complex),
// even though the names share words.
const PLACE_TYPES = [
  ['مجمع', 'complex'], ['حديقه', 'park', 'garden'], ['مستشفي', 'hospital'], ['مدرسه', 'school'], ['مسجد', 'جامع', 'mosque'],
  ['فندق', 'hotel'], ['مطعم', 'restaurant'], ['شارع', 'street'], ['دوار', 'ميدان', 'circle', 'roundabout', 'square'],
  ['جامعه', 'university'], ['مول', 'mall'], ['عياده', 'clinic'], ['صيدليه', 'pharmacy'], ['ملعب', 'stadium'], ['جسر', 'bridge'],
].map((group) => group.map(normalizeArabic))

const typesOf = (s: string) => {
  const words = new Set(normalizeArabic(s).split(' ').map((w) => w.replace(/^ال/, '')))
  return new Set(PLACE_TYPES.flatMap((group, i) => (group.some((t) => words.has(t)) ? [i] : [])))
}

/** A fuzzy hit of a different kind of place than the rider asked for is a different place. */
function sameKind(query: string, hitName: string): boolean {
  const asked = typesOf(query)
  const found = typesOf(hitName)
  return [...found].every((t) => asked.has(t)) || asked.size === 0
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
  /** True when the rider actually said the area («…بالشميساني») rather than the LLM inferring it. */
  areaExplicit?: boolean
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

// A match further than this from the area is a different place («مجمع بنك الإسكان» exists in
// Zarqa too). Areas the rider actually said are enforced tightly; LLM-inferred ones loosely,
// since the model sometimes guesses a neighbouring area.
const RADIUS_KM = { explicitNeighbourhood: 6, explicitCity: 15, inferred: 12 }
const CITIES = ['عمان', 'الزرقاء', 'الرصيفة', 'إربد', 'اربد', 'العقبة', 'السلط', 'مادبا', 'الكرك', 'المفرق', 'جرش', 'عجلون', 'معان', 'الطفيلة', 'Amman', 'Zarqa', 'Irbid', 'Aqaba', 'Salt', 'Madaba', 'Karak', 'Mafraq', 'Jerash', 'Ajloun', "Ma'an", 'Tafila'].map(normalizeArabic)
const AMMAN_CENTER: Candidate = { name: 'عمان', lat: 31.9539, lng: 35.9106, confidence: 0.75, source: 'kb' }

/** «شمساني» / «الشميساني»: try the area as said and with / without the article. */
const areaSpellings = (area: string) => uniqueBy([area, area.startsWith('ال') ? area.slice(2) : `ال${area}`])

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

  // With an area the rider said, search "<place> <area>" first; the bare name (which may be a
  // branch in another city) only comes after, and must still land inside the area.
  const queries =
    q.area && q.areaExplicit
      ? uniqueBy([
          `${q.name} ${q.area}`,
          ...q.candidates.filter((c) => normalizeArabic(c).includes(normalizeArabic(q.area!))),
          q.name,
          ...q.candidates,
        ])
      : uniqueBy([q.name, ...q.candidates])
  const isCity = q.area ? CITIES.includes(normalizeArabic(q.area)) : false
  const radiusKm = q.areaExplicit ? (isCity ? RADIUS_KM.explicitCity : RADIUS_KM.explicitNeighbourhood) : RADIUS_KM.inferred

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
    for (const spelling of areaSpellings(q.area)) {
      const local = resolveFromKnowledgeBase(normalizeArabic(spelling), lang)
      if (local?.kind === 'found') return (areaCenter = local.place)
    }
    // District lookup: «مرج الحمام عمان» first (most districts are in Amman), then Jordan-wide.
    const r =
      (!isCity ? await tryNominatim(`${q.area} ${lang === 'en' ? 'Amman' : 'عمان'}`, CONFIDENCE.area) : null) ??
      (await tryNominatim(`${q.area} ${lang === 'en' ? 'Jordan' : 'الأردن'}`, CONFIDENCE.area)) ??
      (await tryNominatim(q.area, CONFIDENCE.area))
    if (r?.kind === 'found') areaCenter = r.place
    // The rider named an area we can't place: assume it's in Amman rather than accepting anything.
    else if (q.areaExplicit && !isCity) areaCenter = AMMAN_CENTER
    return areaCenter
  }
  const inArea = async (c: Candidate) => {
    const center = await getAreaCenter()
    if (!center) return true
    const limit = center === AMMAN_CENTER ? RADIUS_KM.explicitCity : radiusKm
    return straightLineKm(center, c) <= limit
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
      return fits.length >= 2 ? { kind: 'ambiguous', options: fits } : null
    }
    if (r.kind !== 'found' || !(await inArea(r.place))) return null
    if (!isAreaLevel(r.place)) return r
    // Only the district was found: pin its curated centre (landmark list) when we have one,
    // rather than wherever OSM happens to put the district label.
    const center = await getAreaCenter()
    const pin = center && center !== AMMAN_CENTER && center.source === 'kb' ? { ...r.place, lat: center.lat, lng: center.lng } : r.place
    return { kind: 'found', place: approximate(pin) }
  }

  // L1 — local landmark KB, instant. Only trusted for the rider's own name, or for candidates
  // that share a real word with it. A candidate that is just the surrounding area («العبدلي عمان»
  // for "Kempinski Hotel") is kept as a last-resort approximate answer, after real searches.
  let areaFallback: Candidate | null = null
  for (const [i, name] of queries.entries()) {
    const local = resolveFromKnowledgeBase(normalizeArabic(name), lang)
    if (!local) continue
    // Same-named landmark in a different area than the rider said («دوار الدلة في الزرقاء» is not
    // Marj Al-Hamam's) — keep searching.
    if (q.areaExplicit && local.kind === 'found' && !(await inArea(local.place))) continue
    // The rider's own name matching a landmark (even with a typo, «دوار الواهة») IS that landmark —
    // unless what matched is just the area («دوار الاتصالات مرج الحمام» → «مرج الحمام»).
    if (i === 0) {
      const isJustTheArea =
        local.kind === 'found' && q.area !== null && normalizeArabic(local.place.name) === normalizeArabic(q.area)
      if (!isJustTheArea) return local
      areaFallback ??= local.place
      continue
    }
    const trusted = sharesWord(name, q.name)
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
  const fullName = normalizeArabic(q.name)
  for (const v of variants) {
    const r = await tryNominatim(v, CONFIDENCE.variant)
    const ok = r && (await accept(r))
    if (ok?.kind !== 'found') continue
    if (ok.place.confidence === CONFIDENCE.area) return ok
    // Found only after dropping «دوار» / "Circle": it may be a different place that shares the
    // word («شارع الجندي» for «دوار الجندي»). Say what was found, and mark it approximate.
    const hit = normalizeArabic(ok.place.name)
    if (hit.includes(fullName) || fullName.includes(hit)) return { kind: 'found', place: { ...ok.place, name: q.name } }
    const near = lang === 'en' ? `near ${ok.place.name} - approximate` : `قرب ${ok.place.name} - موقع تقريبي`
    return { kind: 'found', place: { ...ok.place, name: `${q.name} (${near})`, confidence: CONFIDENCE.area } }
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
      if (!sharesWord(queries[i], h.name) || !sameKind(q.name, h.name)) continue
      // Asked for a «مجمع» but found a plain «بنك الإسكان» (a branch): close, but not the place.
      const missingKind = [...typesOf(q.name)].some((t) => !typesOf(h.name).has(t))
      if (missingKind) {
        const near = lang === 'en' ? `near ${h.name} - approximate` : `قرب ${h.name} - موقع تقريبي`
        const ok = await accept({
          kind: 'found',
          place: { name: `${q.name} (${near})`, lat: h.lat, lng: h.lng, confidence: CONFIDENCE.area, source: 'nominatim' },
        })
        if (ok) return ok
        continue
      }
      const named = hasArabic(h.name) === (lang === 'ar') ? h.name : q.name
      const ok = await accept({
        kind: 'found',
        place: { name: named, lat: h.lat, lng: h.lng, confidence: CONFIDENCE.fuzzy, source: 'nominatim' },
      })
      if (ok) return ok
    }
  }

  // L4 — broader area centre, clearly labelled as approximate. The generic Amman centre is only a
  // filter for areas we couldn't place — never an answer: a pin in Zahran labelled «مرج الحمام»
  // is worse than asking the rider.
  if (areaFallback) return { kind: 'found', place: approximate(areaFallback) }
  const center = await getAreaCenter()
  if (center && center !== AMMAN_CENTER) return { kind: 'found', place: approximate(center) }
  return { kind: 'not_found' }
}

/** Canonical landmark names + aliases, used to steer Whisper and the LLM toward local spellings. */
export const knownPlaceNames = (): string[] => [...new Set(ALIASES.map((a) => a.name))]
