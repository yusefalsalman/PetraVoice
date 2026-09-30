import { config } from '../config.ts'
import { RIDE_TYPES, type RideType } from '../contract.ts'
import { AMBIGUOUS_TERMS, LANDMARKS } from '../data/landmarks.ts'
import { normalizeArabic } from '../lib/text.ts'
import type { Lang, PlaceQuery } from './geocode.ts'
import { ai } from './openai.ts'

// Natural-language understanding: pull pickup / dropoff / ride type out of a ride request in
// Jordanian Arabic or English (or a mix), correcting speech-to-text typos and producing
// geocoder search candidates. Primary: LLM function calling (Groq / OpenAI).
// Fallback (no key, or the LLM call fails): a rule-based parser over the landmark list.

export interface Extraction {
  /** Language the rider used — place names are returned in it. */
  language: Lang
  pickup: PlaceQuery | null
  dropoff: PlaceQuery | null
  rideType: RideType | null
}

/** Script-based guess, used by the fallback parser and to sanity-check the LLM. */
export function detectLanguage(transcript: string): Lang {
  const arabic = (transcript.match(/[؀-ۿ]/g) ?? []).length
  const latin = (transcript.match(/[A-Za-z]/g) ?? []).length
  return latin > arabic ? 'en' : 'ar'
}

// ---------------------------------------------------------------- LLM (function calling)

const placeSchema = (side: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['name', 'detail', 'candidates', 'area'],
  properties: {
    name: {
      type: 'string',
      description: `The ${side}: clean, typo-corrected landmark name ONLY (no gate / side / filler), in the request's language. "" if not said.`,
    },
    detail: { type: 'string', description: 'Gate / entrance / side / sub-direction, e.g. "البوابة الشمالية", "Gate 3". "" if none.' },
    candidates: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Up to 4 OpenStreetMap search queries, most specific first, then broader (with neighbourhood / city). Mix Arabic and official English names. Never include gate / notes. [] if not said.',
    },
    area: { type: 'string', description: 'Neighbourhood / district / city the place is in, e.g. "مرج الحمام". "" if unknown.' },
  },
})

const EXTRACT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'extract_ride',
    description: 'Record the pickup, dropoff and ride type from a ride request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['language', 'pickup', 'dropoff', 'rideType'],
      properties: {
        language: { type: 'string', enum: ['ar', 'en'], description: 'Language of the request: "ar" Arabic, "en" English.' },
        pickup: placeSchema('pickup (where the ride starts)'),
        dropoff: placeSchema('dropoff (where the rider wants to go)'),
        rideType: { type: 'string', enum: [...RIDE_TYPES, 'none'], description: 'Only if the rider asked for one, else "none".' },
      },
    },
  },
}

const SYSTEM_PROMPT = `You are the location brain of a ride-hailing app in Jordan (mostly Amman). You read one ride request — Jordanian colloquial Arabic or English (tourists, expats), sometimes mixed, often from speech-to-text — and call extract_ride.

0) LANGUAGE
Set "language" to the language the rider mostly used ("ar" or "en"). Write each place "name" in that language (English: official English name, e.g. "Queen Alia International Airport"; Arabic: «مطار الملكة علياء الدولي»).

1) WHO GOES WHERE (any word order)
- Arabic pickup cues: «من»، «انا عند»، «انا في»، «انا بـ»، «موجود عند». Dropoff cues: «على»، «ع»، «لـ» («لمستشفى»)، «إلى»، «لعند»، «بدي اروح»، «وصلني على»، «روّحني».
- English pickup cues: "from", "pick me up (from/at)", "I'm (currently) at", "I'm near". Dropoff cues: "to", "drop me (off) at", "heading to/towards", "take me to", "going to".
- Order doesn't matter: "To Airport from 8th circle" → pickup 8th Circle, dropoff Airport.
- Rider at their current location («هون»، «موقعي»، "here", "my location") or no start given → pickup.name = "". Never invent a place that wasn't said.
- Ignore fillers and chit-chat in both languages: «يا غالي»، «الله يخليك»، «بسرعة»، «لو سمحت»، "please hurry", "hey man", "bro", "thanks".

2) CLEAN NAME vs NOTES
"name" is only the searchable landmark. Gates, entrances, sides and sub-directions go in "detail":
- «دوار الواحة جهة تلاع العلي» → name «دوار الواحة», detail «جهة تلاع العلي»
- "City Mall gate 3" → name "City Mall", detail "Gate 3"; "Queen Alia Airport, gate 2" → name "Queen Alia International Airport", detail "Gate 2"

3) FIX SPEECH-TO-TEXT MISTAKES
Correct obvious phonetic errors to the real Jordanian place:
- «مستشفى الأمير فاسل» → «مستشفى الأمير فيصل»; «الخالدى» → «مستشفى الخالدي»; «العبدلى» → «العبدلي».
- Nicknames: «التكنو» / «التكنولوجيا» → «جامعة العلوم والتكنولوجيا الأردنية»; «البوليفارد» → «العبدلي بوليفارد»; «السابع» → «الدوار السابع»; «البلد» → «وسط البلد»; «الأردنية» → «الجامعة الأردنية»; "Citadel" → "Amman Citadel"; "the airport" → "Queen Alia International Airport".
- Vague category fitting several places (just «الجامعة» / «المول» / "the university" / "the mall") → name is exactly that word; don't pick one.

4) SEARCH CANDIDATES (for OpenStreetMap, which often lacks colloquial names)
Give up to 4 queries per place, in this priority order:
  a) the full name; b) the official English OSM name — ALWAYS for hospitals, universities, malls, hotels and
  other facilities, since many exist on OSM only in English; c) a keyword variant with the city; d) the area anchor.
- «مستشفى الجامعة الأردنية» → area «الجبيهة», candidates ["Jordan University Hospital", "مستشفى الجامعة الأردنية عمان", "مستشفى الجامعة عمان", "الجبيهة عمان"]
Examples:
- «دوار الدلة في مرج الحمام» → name «دوار الدلة», area «مرج الحمام», candidates ["ميدان الدلة مرج الحمام", "دوار مرج الحمام", "مرج الحمام عمان"]
- «البيادر» → name «البيادر», area «بيادر وادي السير», candidates ["بيادر وادي السير عمان", "البيادر عمان"]
- «دوار باريس» → name «دوار باريس», area «جبل اللويبدة», candidates ["ميدان باريس جبل اللويبدة", "اللويبدة عمان"]
- «مستشفى الأمير فيصل» → area «الزرقاء», candidates ["مستشفى الامير فيصل الزرقاء", "مستشفى الامير فيصل ياجوز", "Prince Faisal Hospital"]
- «دوار الاتصالات» → candidates ["دوار الاتصالات", "مجمع الاتصالات عمان"]
- "Queen Alia Airport" → ["Queen Alia International Airport", "مطار الملكة علياء الدولي"]
- Always include the name in the other language when you know it, e.g. «جامعة الطفيلة» → "Tafila Technical University".
"area" is the neighbourhood / district / city to fall back to if the exact spot isn't on the map. Unknown → "".

5) RIDE TYPE
"xl" for family / big car / van / 5+ people, "comfort" for a comfortable or nicer car, "economy" if they ask for the cheapest; otherwise "none".`

const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null)

function toPlaceQuery(raw: unknown): PlaceQuery | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const name = text(p.name)
  if (!name) return null
  const candidates = Array.isArray(p.candidates)
    ? p.candidates.map(text).filter((c): c is string => c !== null).slice(0, 4)
    : []
  return { name, detail: text(p.detail), candidates, area: text(p.area) }
}

async function extractWithLlm(transcript: string): Promise<Extraction> {
  const completion = await ai!.chat.completions.create({
    model: config.ai.llmModel,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'function', function: { name: 'extract_ride' } },
  })
  const call = completion.choices[0]?.message?.tool_calls?.[0]
  if (!call || call.type !== 'function') throw new Error('LLM did not call extract_ride')
  const args = JSON.parse(call.function.arguments) as Record<string, unknown>

  return {
    language: args.language === 'en' || args.language === 'ar' ? args.language : detectLanguage(transcript),
    pickup: toPlaceQuery(args.pickup),
    dropoff: toPlaceQuery(args.dropoff),
    rideType: RIDE_TYPES.includes(args.rideType as RideType) ? (args.rideType as RideType) : null,
  }
}

// ---------------------------------------------------------------- Rule-based fallback

interface Mention {
  start: number
  end: number
  name: string
}

// Every spelling we know, longest first, normalised.
const TERMS = [
  ...LANDMARKS.flatMap((l) => [l.name, l.en, ...l.aliases].map((a) => ({ term: normalizeArabic(a), name: l.name }))),
  ...AMBIGUOUS_TERMS.map((g) => ({ term: normalizeArabic(g.term), name: g.term })),
].sort((a, b) => b.term.length - a.term.length)

function findMentions(t: string): Mention[] {
  const found: Mention[] = []
  for (const { term, name } of TERMS) {
    for (let at = t.indexOf(term); at !== -1; at = t.indexOf(term, at + 1)) {
      const m = { start: at, end: at + term.length, name }
      const overlaps = found.some((f) => m.start < f.end && f.start < m.end)
      if (!overlaps && !found.some((f) => f.name === name)) found.push(m)
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

// Cues are matched against the normalised text (lower-case, apostrophes → spaces: "i'm" → "i m").
const PICKUP_CUE =
  /(?:^|\s)(?:من|عند|انا في|انا ب|انا بال|موجود في|موجود عند|from|pick me up|pick me up from|pick me up at|pickup from|(?:i m|im|i am)(?: currently| now)? (?:at|near|in))\s*$/
const DROPOFF_CUE =
  /(?:^|\s)(?:الي|علي|ع|لعند|اروح|اروح علي|وصلني|وصلني علي|روحني|بدي|to|towards|drop me off at|drop me at|drop off at|drop me off|heading|heading to|heading towards|going to)\s*$|(?:^|\s)ل$/

function roleOf(t: string, m: Mention): 'pickup' | 'dropoff' | null {
  const before = t.slice(0, m.start)
  // Dropoff first: "drop me off at" ends in "at" like the pickup cue "I'm at".
  if (DROPOFF_CUE.test(before)) return 'dropoff'
  if (PICKUP_CUE.test(before)) return 'pickup'
  return null
}

// «… إلى مستشفى الخالدي» / "… to Khalidi Hospital"; a phrase ends where the other side's cue begins.
const TO_PHRASE = /(?:^|\s)(?:إلى|الى|على|علي|لعند)\s+(.+?)(?=\s+(?:و?انا|من|و?أنا)\s|$)/
const FROM_PHRASE = /(?:^|\s)(?:من|انا عند|أنا عند|انا في|أنا في)\s+(.+?)(?=\s+(?:إلى|الى|على|علي|لعند|بدي)\s|$)/
const TO_PHRASE_EN = /(?:^|\s)(?:to|towards|drop me off at|drop me at)\s+(.+?)(?=\s+(?:from|and|i['’]?m|i am)\s|[,.]|$)/i
const FROM_PHRASE_EN = /(?:^|\s)(?:from|pick me up (?:from|at)|i['’]?m (?:currently )?at|i am (?:currently )?at)\s+(.+?)(?=\s+(?:to|towards|and|heading|drop)\s|[,.]|$)/i
// «دوار الدلة في مرج الحمام» → place «دوار الدلة», area «مرج الحمام».
const IN_AREA = /^(.+?)\s+(?:في|ب|بـ)\s+(.+)$/
const FILLER = /\s+(?:لو سمحت|بليز|يا غالي|الله يخليك|بسرعة|please(?: hurry)?|hurry|thanks|bro|man)$/i

function freeText(transcript: string, pattern: RegExp, other: string | null): string | null {
  const phrase = transcript.match(pattern)?.[1]?.replace(FILLER, '').trim()
  if (!phrase || phrase.split(/\s+/).length > 7) return null
  // Don't return the side we already resolved from the landmark list.
  if (other && normalizeArabic(phrase).includes(normalizeArabic(other))) return null
  return phrase
}

const asQuery = (phrase: string | null): PlaceQuery | null => {
  if (!phrase) return null
  const inArea = phrase.match(IN_AREA)
  return inArea
    ? { name: inArea[1].trim(), detail: null, candidates: [`${inArea[1].trim()} ${inArea[2].trim()}`], area: inArea[2].trim() }
    : { name: phrase, detail: null, candidates: [], area: null }
}

function detectRideType(t: string): RideType | null {
  if (/xl|عائلي|عيله|كبيره|فان|van|family/.test(t)) return 'xl'
  if (/مريح|كومفورت|comfort/.test(t)) return 'comfort'
  return null
}

export function extractWithRules(transcript: string): Extraction {
  const t = normalizeArabic(transcript)
  const mentions = findMentions(t).slice(0, 2)
  let pickup: string | null = null
  let dropoff: string | null = null
  const unassigned: Mention[] = []

  for (const m of mentions) {
    const role = roleOf(t, m)
    if (role === 'pickup' && !pickup) pickup = m.name
    else if (role === 'dropoff' && !dropoff) dropoff = m.name
    else unassigned.push(m)
  }
  // No cue: with two places the first is the pickup; a lone place is the destination.
  for (const m of unassigned) {
    if (!pickup && !dropoff && unassigned.length === 2) pickup = m.name
    else if (!dropoff) dropoff = m.name
    else if (!pickup) pickup = m.name
  }

  // Places we don't know: take the free text after the cue for whichever side is missing.
  const language = detectLanguage(transcript)
  const [toPhrase, fromPhrase] = language === 'en' ? [TO_PHRASE_EN, FROM_PHRASE_EN] : [TO_PHRASE, FROM_PHRASE]
  const dropoffText = dropoff ?? freeText(transcript, toPhrase, pickup)
  const pickupText = pickup ?? freeText(transcript, fromPhrase, dropoffText)

  return { language, pickup: asQuery(pickupText), dropoff: asQuery(dropoffText), rideType: detectRideType(t) }
}

// ---------------------------------------------------------------- Public

export async function extractRide(transcript: string): Promise<Extraction> {
  if (ai) {
    // The model occasionally answers in prose instead of calling the tool — one retry fixes it.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await extractWithLlm(transcript)
      } catch (e) {
        const message = (e as Error).message
        const retryable = /did not call a tool|did not call extract_ride|tool_use_failed/i.test(message)
        if (attempt === 1 && retryable) continue
        console.error('[nlu] LLM extraction failed, using rule-based fallback:', message)
        break
      }
    }
  }
  return extractWithRules(transcript)
}
