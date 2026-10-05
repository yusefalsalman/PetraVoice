import { config } from '../config.ts'
import { RIDE_TYPES, type RideType } from '../contract.ts'
import { AMBIGUOUS_TERMS, LANDMARKS } from '../data/landmarks.ts'
import { editDistance, normalizeArabic } from '../lib/text.ts'
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

// Known speech-to-text mishearings, fixed before any parsing (so the rule-based fallback
// benefits too). Keep them specific: «ورد» alone is a real word (flowers).
const STT_FIXES: [RegExp, string][] = [
  [/(^|\s)(?:ورد|دور|دوّار)\s+(?:ال)?جندي(?=\s|$|[،,.])/g, '$1دوار الجندي'],
  [/(^|\s)(?:ورد|دور)\s+(?:ال)?(واحة|واحه|دلة|دله|داخلية|داخليه|سابع|ثامن|خامس|سادس|رابع|ثالث|ثاني|أول|اول)(?=\s|$|[،,.])/g, '$1دوار ال$2'],
  [/(^|\s)(?:ورد|دور)\s+صويلح(?=\s|$|[،,.])/g, '$1دوار صويلح'],
  [/الأمير فاسل|الامير فاسل/g, 'الأمير فيصل'],
]

/** Applies the known speech-to-text fixes; returns the text unchanged if none match. */
export function correctTranscript(transcript: string): string {
  return STT_FIXES.reduce((t, [pattern, fix]) => t.replace(pattern, fix), transcript)
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
  required: ['name', 'gate', 'candidates', 'area'],
  properties: {
    name: {
      type: 'string',
      description: `The ${side}: clean, typo-corrected landmark name ONLY (no gate / side / filler), in the request's language. "" if not said.`,
    },
    gate: {
      type: 'string',
      description:
        'Gate / entrance / sub-location of the place, in canonical form: "بوابة 2", "البوابة الشمالية", "المدخل الرئيسي", "Gate 2", "Main Gate", "Parking Gate", "Emergency"; or a side such as "جهة تلاع العلي". "" if none.',
    },
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

2) CLEAN NAME vs GATE
"name" is only the searchable landmark. Gates, entrances, sides and sub-locations go in "gate" — the app pins the
exact gate for big landmarks, so never drop one and never leave it inside "name":
- «مكة مول بوابة 2» / «مكة مول البوابة التانية» → name «مكة مول», gate «بوابة 2» (ordinals as digits: «الأولى» → 1, «التانية» → 2, «التالتة» → 3)
- «الجامعة الأردنية من بوابة الزراعة» → name «الجامعة الأردنية», gate «بوابة الزراعة»; «البوابة الشمالية للأردنية» → gate «البوابة الشمالية»
- «سيتي مول من عند الباركينج» → gate «بوابة المواقف»; «مستشفى الجامعة الطوارئ» → name «مستشفى الجامعة الأردنية», gate «الطوارئ»
- «دوار الواحة جهة تلاع العلي» → name «دوار الواحة», gate «جهة تلاع العلي»
- "Mecca Mall gate two" → name "Mecca Mall", gate "Gate 2"; "City Mall parking entrance" → gate "Parking Gate"; "UJ main gate" → name "University of Jordan", gate "Main Gate"; "Queen Alia Airport, terminal 1" → gate "Terminal 1"

2b) TRAFFIC CIRCLES ARE PLACES — keep them whole
A circle is a precise point, not its neighbourhood. Keep «دوار» / "Circle" in the name, and use the canonical form:
- «دوار صويلح» stays «دوار صويلح» (area «صويلح») — never shorten it to the district «صويلح». Strip only the
  preposition: «لدوار صويلح» / «عدوار صويلح» / «على دوار صويلح» → «دوار صويلح».
- Nicknames: «الكيلو» / «دوار الكيلو» / «دوار الحرمين» → «دوار الكيلو» ("Kilo Circle" → "Al-Kilo Circle").
- Numbered circles: «السابع» / «دوار السابع» / «ع السابع» → «الدوار السابع»; "7th circle" / "seventh circle" → "7th Circle". Same for الأول … الثامن.
- «دوار المدينة» / «المدينة الرياضية» → «دوار المدينة الرياضية»; «الواحة» → «دوار الواحة».

2c) CITIES ARE DESTINATIONS TOO — the app works across Jordan, not only Amman
A city or town said on its own is the place itself: «من الطفيلة على العقبة» → pickup name «الطفيلة», dropoff name
«العقبة» (area ""). Same for الكرك، معان، المفرق، إربد، الرمثا، الزرقاء، السلط، مادبا، جرش، عجلون، البتراء / وادي موسى،
وادي رم، البحر الميت، الأزرق، الشوبك, and "Aqaba", "Karak", "Irbid", "Petra", "Dead Sea"… Never turn a city into a street
(«شارع العقبة», «شارع الطفيل بن النعمان») and never move it to "area" of another place.

3) FIX SPEECH-TO-TEXT MISTAKES
Transcripts come from speech recognition and contain acoustic mishearings. If a word sounds like a known
Jordanian circle, monument, hospital or university, map it to that landmark — never drop it:
- «دوار» is often heard as «ورد» or «دور»: «ورد جندي» / «دور جندي» → «دوار الجندي»; «ورد الواحة» → «دوار الواحة».
- «مستشفى الأمير فاسل» → «مستشفى الأمير فيصل»; «الخالدى» → «مستشفى الخالدي»; «العبدلى» → «العبدلي».
- Nicknames: «التكنو» / «التكنولوجيا» → «جامعة العلوم والتكنولوجيا الأردنية»; «البوليفارد» → «العبدلي بوليفارد»; «السابع» → «الدوار السابع»; «البلد» → «وسط البلد»; «الأردنية» → «الجامعة الأردنية»; "Citadel" → "Amman Citadel"; "the airport" → "Queen Alia International Airport".
- Vague category fitting several places (just «الجامعة» / «المستشفى» / «المدرسة» / «المول» / "the university" / "the hospital" / "the school" / "the mall") → name is exactly that word and candidates []; never pick one — the app asks the rider.

4) AREA THE RIDER SAID
If the rider names a neighbourhood / district / city with the place («مجمع بنك الإسكان بالشميساني»، «في مرج الحمام»، "in Abdoun"):
- put it in "area", spelled canonically («الشميساني» not «شمساني»), and
- attach it to EVERY search candidate: ["مجمع بنك الإسكان الشميساني عمان", "بنك الإسكان الشميساني", "Housing Bank Complex Shmeisani Amman", "الشميساني عمان"].
- Never give a bare search for a name that has branches in many places (banks, supermarkets, pharmacies, clinics, restaurants chains, schools, «كارفور», «سامح مول»…) — always attach the area; if none was said, attach «عمان».

5) SEARCH CANDIDATES (for OpenStreetMap, which often lacks colloquial names)
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

6) RIDE TYPE (only if the rider asked for one — otherwise "none")
- "xl": family / big car / lots of luggage / 5+ people — «عائلية»، «للعيلة»، «سيارة كبيرة»، «باص»، «فان»، «معي شناتي»، «ست أشخاص»، "family", "XL", "van", "luggage", "6 people".
- "comfort": a nicer car — «مريحة»، «فخمة»، «كومفورت»، «VIP»، "comfort", "luxury", "premium".
- "economy": explicitly cheap / small / normal — «صغيرة»، «رخيصة»، «عادي»، «اقتصادي»، "economy", "cheapest".`

const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null)

function toPlaceQuery(raw: unknown): PlaceQuery | null {
  const p = (raw ?? {}) as Record<string, unknown>
  const name = text(p.name)
  if (!name) return null
  const candidates = Array.isArray(p.candidates)
    ? p.candidates.map(text).filter((c): c is string => c !== null).slice(0, 4)
    : []
  // The model sometimes leaves the gate inside the name ("Mecca Mall Gate 2") — split it off.
  const gate = text(p.gate) ?? text(p.detail)
  const { name: clean, detail } = gate ? { name, detail: gate } : splitDetail(name)
  return { name: clean, detail, candidates, area: text(p.area) }
}

async function extractWithLlm(transcript: string, model = config.ai.llmModel): Promise<Extraction> {
  const completion = await ai!.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'function', function: { name: 'extract_ride' } },
  },
    // No SDK auto-retry: a rate-limited model won't recover in seconds — move on to the fallback
    // model (see extractRideRaw) instead of waiting.
    { maxRetries: 0, timeout: 12_000 },
  )
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
  /(?:^|\s)(?:الي|علي|ع|لعند|اروح|اروح علي|وصلني|وصلني علي|روحني|بدي|to|towards|drop me off at|drop me at|drop off at|drop me off|heading|heading to|heading towards|going to)\s*$|(?:^|\s)ل\s*$/

// «…دوار الدلة في مرج الحمام» / «…بالشميساني» / "… in Abdoun": the place right after is the
// previous place's area, not a pickup or dropoff. (Checked after the pickup cue «انا بـ».)
const AREA_CUE = /(?:^|\S\s+)(?:في|ب|بـ|in)\s*$|\S\s+ب$/

function roleOf(t: string, m: Mention): 'pickup' | 'dropoff' | 'area' | null {
  const before = t.slice(0, m.start)
  // Dropoff first: "drop me off at" ends in "at" like the pickup cue "I'm at".
  if (DROPOFF_CUE.test(before)) return 'dropoff'
  if (PICKUP_CUE.test(before)) return 'pickup'
  if (AREA_CUE.test(before)) return 'area'
  return null
}

// «… إلى مستشفى الخالدي» / "… to Khalidi Hospital"; a phrase ends where the other side's cue begins.
const TO_PHRASE = /(?:^|\s)(?:إلى|الى|على|علي|لعند)\s+(.+?)(?=\s+(?:و?انا|من|و?أنا)\s|$)/
const FROM_PHRASE = /(?:^|\s)(?:من|انا عند|أنا عند|انا في|أنا في)\s+(.+?)(?=\s+(?:إلى|الى|على|علي|لعند|بدي)\s|$)/
const TO_PHRASE_EN = /(?:^|\s)(?:to|towards|drop me off at|drop me at)\s+(.+?)(?=\s+(?:from|and|i['’]?m|i am)\s|[,.]|$)/i
const FROM_PHRASE_EN = /(?:^|\s)(?:from|pick me up (?:from|at)|i['’]?m (?:currently )?at|i am (?:currently )?at)\s+(.+?)(?=\s+(?:to|towards|and|heading|drop)\s|[,.]|$)/i
// «دوار الدلة في مرج الحمام» → place «دوار الدلة», area «مرج الحمام».
// Also the attached form «مجمع بنك الإسكان بالشميساني» (ب + ال…).
const IN_AREA = /^(.+?)\s+(?:(?:في|ب|بـ)\s+|ب(?=ال))(.+)$/
const FILLER = /\s+(?:لو سمحت|بليز|يا غالي|الله يخليك|بسرعة|please(?: hurry)?|hurry|thanks|bro|man)$/i

function freeText(transcript: string, pattern: RegExp, other: string | null): string | null {
  const phrase = transcript.match(pattern)?.[1]?.replace(FILLER, '').trim()
  if (!phrase || phrase.split(/\s+/).length > 7) return null
  // Don't return the side we already resolved from the landmark list.
  if (other && normalizeArabic(phrase).includes(normalizeArabic(other))) return null
  return phrase
}

// «…بوابة 2» / «…البوابة الشمالية» / "… gate 3" / "terminal 1": notes, not part of the searched name.
// "parking gate" / "main entrance": English puts the gate word last.
const NAMED_GATE = /(?:main|front|back|side|north|northern|south|southern|east|west|parking|agriculture|engineering|emergency)\s+(?:gate|entrance)/
const DETAIL = new RegExp(
  `\\s*[,،]?\\s*((?:ال)?(?:بوابه|بوابة|باب|مدخل|مخرج|جهة|جهه|طابق)\\s+\\S+|(?:gate|entrance|terminal|exit|door|floor)\\s+\\S+|${NAMED_GATE.source})\\s*$`,
  'i',
)

/** A gate phrase right after a landmark, in normalised text. */
const GATE_AFTER = new RegExp(`^\\s*((?:ال)?(?:بوابه|مدخل|باب)\\s+\\S+|(?:gate|entrance|terminal)\\s+\\S+|${NAMED_GATE.source})`, 'i')

/** Splits a trailing gate / entrance note off a place phrase. */
function splitDetail(phrase: string): { name: string; detail: string | null } {
  const m = phrase.match(DETAIL)
  if (!m || m.index === undefined || m.index === 0) return { name: phrase, detail: null }
  const detail = m[1].replace(/^(gate|entrance|terminal|exit|door|floor)/i, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
  return { name: phrase.slice(0, m.index).trim(), detail }
}

const asQuery = (phrase: string | null): PlaceQuery | null => {
  if (!phrase) return null
  const { name, detail } = splitDetail(phrase)
  const inArea = name.match(IN_AREA)
  return inArea
    ? { name: inArea[1].trim(), detail, candidates: [`${inArea[1].trim()} ${inArea[2].trim()}`], area: inArea[2].trim() }
    : { name, detail, candidates: [], area: null }
}

// Ride-type words (normalised: ة→ه, أ→ا). Checked XL → comfort → economy; "none said" → null.
const RIDE_WORDS: [RideType, RegExp][] = [
  ['xl', /(?:^|\s)(?:\S*عائلي\S*|\S*عيله\S*|للعيله|سياره كبيره|كبيره|باص|فان|شناتي|شنط|(?:5|6|7|خمس|ست|سبع)ه? (?:اشخاص|ركاب|انفار)|xl|family|van|luggage|bags|[5-7] (?:people|persons|passengers))(?:\s|$)/],
  ['comfort', /(?:^|\s)(?:مريحه|مريح|فخمه|فخم|كومفورت|vip|comfort|luxury|premium)(?:\s|$)/],
  ['economy', /(?:^|\s)(?:صغيره|رخيصه|ارخص|عادي|عاديه|اقتصادي|economy|cheap|cheapest|standard)(?:\s|$)/],
]

export function detectRideType(t: string): RideType | null {
  const text = normalizeArabic(t)
  return RIDE_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

export function extractWithRules(transcript: string): Extraction {
  // «للمطار» is «ل» + «المطار» merged — split it so «المطار» is found and «ل» reads as "to".
  const t = normalizeArabic(transcript).replace(/(^|\s)لل(?=\S{3,})/g, '$1ل ال')
  const mentions = findMentions(t).slice(0, 2)
  let pickup: string | null = null
  let dropoff: string | null = null
  const unassigned: Mention[] = []

  // «مكة مول بوابه 2»: keep the gate said right after a known landmark (splitDetail takes it off).
  const named = (m: Mention) => {
    const gate = t.slice(m.end).match(GATE_AFTER)?.[1]
    return gate ? `${m.name} ${gate}` : m.name
  }
  for (const m of mentions) {
    const role = roleOf(t, m)
    if (role === 'area') continue // «في مرج الحمام» describes the other place
    if (role === 'pickup' && !pickup) pickup = named(m)
    else if (role === 'dropoff' && !dropoff) dropoff = named(m)
    else unassigned.push(m)
  }
  // No cue: with two places the first is the pickup; a lone place is the destination.
  for (const m of unassigned) {
    if (!pickup && !dropoff && unassigned.length === 2) pickup = named(m)
    else if (!dropoff) dropoff = named(m)
    else if (!pickup) pickup = named(m)
  }

  // Places we don't know: take the free text after the cue for whichever side is missing.
  const language = detectLanguage(transcript)
  const [toPhrase, fromPhrase] = language === 'en' ? [TO_PHRASE_EN, FROM_PHRASE_EN] : [TO_PHRASE, FROM_PHRASE]
  const dropoffText = dropoff ?? freeText(transcript, toPhrase, pickup)
  const pickupText = pickup ?? freeText(transcript, fromPhrase, dropoffText)

  return { language, pickup: asQuery(pickupText), dropoff: asQuery(dropoffText), rideType: detectRideType(t) }
}

// ---------------------------------------------------------------- Explicit areas

/** «بالشميساني» → «شميساني», «والعبدلي» → «عبدلي»: bare word for comparison. */
const bareWord = (w: string) => w.replace(/^(?:وبال|بال|وال|لل|ال|ب|و|ل)(?=\S{3,})/, '').replace(/^ال/, '')

/**
 * Marks an area as explicit when the rider actually said it, and adopts the rider's spelling
 * (the LLM wrote «شمساني» for «بالشميساني»). Inferred areas stay loose hints.
 */
export function withExplicitArea(q: PlaceQuery | null, transcript: string): PlaceQuery | null {
  if (!q?.area) return q
  const words = normalizeArabic(transcript).split(' ')
  const llmWords = q.area.trim().split(/\s+/)
  const areaWords = llmWords.map((w) => bareWord(normalizeArabic(w)))

  // Multi-word areas («مرج الحمام»): all words present in order, ignoring prepositions / article.
  const bare = words.map(bareWord)
  for (let i = 0; i + areaWords.length <= bare.length; i++) {
    const window = bare.slice(i, i + areaWords.length)
    const close = window.every((w, k) => w === areaWords[k] || (w.length >= 5 && editDistance(w, areaWords[k], 1) <= 1))
    if (!close) continue
    // Rebuild the area without the rider's prepositions («بمرج الحمام» → «مرج الحمام»): keep the
    // LLM's spelling where it matches, otherwise the rider's word, with the article if either had it.
    const area = window
      .map((w, k) => {
        if (w === areaWords[k]) return llmWords[k]
        const spokenHadArticle = /^(?:و|ب|ل|ف)?ال/.test(words[i + k])
        return llmWords[k].startsWith('ال') || spokenHadArticle ? `ال${w}` : w
      })
      .join(' ')
    return { ...q, area, areaExplicit: true }
  }
  return { ...q, areaExplicit: false }
}

// ---------------------------------------------------------------- Public

// Type words say nothing about WHICH place — «دوار» in the transcript doesn't back «دوار X».
const TYPE_WORDS = new Set(
  ['دوار', 'ميدان', 'شارع', 'مستشفي', 'مجمع', 'جامعه', 'مول', 'مسجد', 'فندق', 'مطعم', 'مركز', 'دولي', 'عمان', 'الاردن',
    'circle', 'roundabout', 'street', 'hospital', 'mall', 'university', 'hotel', 'the', 'of', 'international', 'amman', 'jordan'].map(normalizeArabic),
)

// "Seventh Circle" said, "7th Circle" claimed: the same place. Arabic ordinals («السابع») are
// spelled the same both ways already.
const ORDINAL_WORDS: Record<string, string> = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th',
}
const ordinal = (w: string) => ORDINAL_WORDS[w] ?? w

/**
 * Is this place backed by what the rider said? The LLM may correct spelling and nicknames
 * («التكنو» → «…التكنولوجيا…», "the airport" → "Queen Alia…"), but it once turned «انا بطبربور»
 * into Queen Alia Airport. A name sharing no real word (or word prefix) with the transcript is rejected.
 */
export function grounded(q: PlaceQuery | null, transcript: string): boolean {
  if (!q) return true
  const said = normalizeArabic(transcript).split(' ').map(bareWord).map(ordinal).filter((w) => w.length >= 3)
  const claimed = normalizeArabic(q.name)
    .split(' ')
    .map(bareWord)
    .map(ordinal)
    .filter((w) => w.length >= 3 && !TYPE_WORDS.has(w))
  if (claimed.length === 0) return true // e.g. just «الجامعة» — nothing to contradict
  return claimed.some((t) =>
    said.some(
      (w) =>
        w === t ||
        (w.length >= 4 && (t.startsWith(w) || w.startsWith(t))) ||
        (w.length >= 4 && editDistance(w, t, 1) <= 1),
    ),
  )
}

// ---------------------------------------------------------------- Fast path (no LLM)

/** Every landmark spelling we know exactly, normalised. */
const KNOWN_NAMES = new Set(LANDMARKS.flatMap((l) => [l.name, l.en, ...l.aliases]).map(normalizeArabic))
// The app's own composed requests: «إلى X» / «من X إلى Y» / "to X" / "from X to Y".
const COMPOSED: [RegExp, Lang][] = [
  [/^(?:من\s+(.+?)\s+)?(?:إلى|الى)\s+(.+?)[.،]?$/, 'ar'],
  [/^(?:from\s+(.+?)\s+)?to\s+(.+?)\.?$/i, 'en'],
]

/**
 * A request that names only exact, known landmarks in the app's own wording — e.g. the
 * «إلى مستشفى الخالدي» sent when the rider taps a «قصدك؟» option — needs no understanding:
 * answer it from the registry without an LLM round trip (no tokens, ~1 s faster).
 */
export function quickExtract(transcript: string): Extraction | null {
  for (const [pattern, language] of COMPOSED) {
    const m = transcript.trim().match(pattern)
    if (!m) continue
    const [, pickup, dropoff] = m
    if (!KNOWN_NAMES.has(normalizeArabic(dropoff)) || (pickup && !KNOWN_NAMES.has(normalizeArabic(pickup)))) return null
    const q = (name: string): PlaceQuery => ({ name: name.trim(), detail: null, candidates: [], area: null })
    return { language, pickup: pickup ? q(pickup) : null, dropoff: q(dropoff), rideType: detectRideType(transcript) }
  }
  return null
}

export async function extractRide(transcript: string): Promise<Extraction> {
  const quick = quickExtract(transcript)
  if (quick) {
    console.log('[nlu] fast path — known landmarks only, no LLM call')
    return quick
  }
  const ex = await extractRideRaw(transcript)
  // Cross-check with the rule-based reading of the actual words: replace a side the LLM invented,
  // and fill a side it missed («انا بطبربور» dropped) when the words clearly name one.
  let rules: Extraction | null = null
  for (const side of ['pickup', 'dropoff'] as const) {
    const current = ex[side]
    if (current && grounded(current, transcript)) continue
    rules ??= extractWithRules(transcript)
    const fromWords = rules[side]
    const other = ex[side === 'pickup' ? 'dropoff' : 'pickup']
    const duplicate = fromWords && other && normalizeArabic(fromWords.name) === normalizeArabic(other.name)
    if (current) console.warn(`[nlu] ${side} «${current.name}» isn't in the transcript — using the rule-based reading`)
    else if (fromWords && !duplicate) console.warn(`[nlu] LLM missed the ${side}; the words say «${fromWords.name}»`)
    ex[side] = duplicate ? null : fromWords
  }
  return {
    ...ex,
    // The LLM sometimes skips the ride type; the keyword list catches «سيارة عائلية» / "luggage".
    rideType: ex.rideType ?? detectRideType(transcript),
    pickup: withExplicitArea(ex.pickup, transcript),
    dropoff: withExplicitArea(ex.dropoff, transcript),
  }
}

async function extractRideRaw(transcript: string): Promise<Extraction> {
  if (ai) {
    // Main model first; if it's rate-limited (Groq limits are per model), the fallback model.
    const models = [config.ai.llmModel, config.ai.llmFallbackModel].filter((m): m is string => Boolean(m))
    for (const model of models) {
      // The model occasionally answers in prose instead of calling the tool — one retry fixes it.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          return await extractWithLlm(transcript, model)
        } catch (e) {
          const message = (e as Error).message
          const retryable = /did not call a tool|did not call extract_ride|tool_use_failed/i.test(message)
          if (attempt === 1 && retryable) continue
          const rateLimited = /\b429\b|rate limit/i.test(message)
          console.error(`[nlu] ${model} failed${rateLimited ? ' (rate limit)' : ''}:`, message.slice(0, 160))
          break
        }
      }
    }
    console.error('[nlu] no LLM available — using the rule-based parser')
  }
  return extractWithRules(transcript)
}
