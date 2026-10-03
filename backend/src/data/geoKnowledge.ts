import { normalizeArabic } from '../lib/text.ts'
import type { Landmark } from './landmarks.ts'

// Local geographic registry, checked before any map search:
//  1. GATED_LANDMARKS — road-side gates of big landmarks. A pin at a mall's centre is on the roof;
//     the driver needs the gate.
//  2. JORDAN_CIRCLES — traffic circles, pinned on the roundabout itself.
// Coordinates are OpenStreetMap entrance / gate / roundabout data (checked 2026-10) unless marked
// "team". Gates not listed here (JUH Emergency / Clinics) still reach the driver as a note, at the
// landmark's own pin.

// ---------------------------------------------------------------- Gates

export interface Gate {
  id: string
  ar: string
  en: string
  /** Tested against the normalised gate text (see gateKey): ordinals already turned into digits. */
  match: RegExp
  lat: number
  lng: number
}

export interface GatedLandmark {
  /** Landmark name without any gate, for labels like «الجامعة الأردنية • البوابة الرئيسية». */
  ar: string
  en: string
  gates: Gate[]
}

// A gate number only counts next to a gate word: «الطابق 2» is a floor, not Gate 2.
const GATE_WORD = '(?:بوابه|باب|مدخل|gate|entrance|door)'
/** «بوابة 2» / «البوابة الثانية» / "gate two" / "second gate" (after gateKey). */
const num = (n: number) =>
  new RegExp(`${GATE_WORD}\\s*(?:رقم|no|number|#)?\\s*${n}(?!\\d)|(?:^|\\s)${n}\\s*${GATE_WORD}`)
/** «المدخل الرئيسي» keeps its «ئ» through normalizeArabic. */
const MAIN = /رئيس|رييس|امامي|main|front/

/** Keyed by landmark id (data/landmarks.ts). */
export const GATED_LANDMARKS: Record<string, GatedLandmark> = {
  mecca: {
    ar: 'مكة مول',
    en: 'Mecca Mall',
    // Gates 1–2: OSM entrance nodes on the east façade (north, south). Gate 3: the surface car park
    // on the west side. OSM doesn't say which entrance carries which number — this numbering is
    // ours: verify on site before relying on it.
    gates: [
      { id: 'g1', ar: 'بوابة 1', en: 'Gate 1', match: num(1), lat: 31.97779, lng: 35.84444 },
      { id: 'g2', ar: 'بوابة 2', en: 'Gate 2', match: num(2), lat: 31.97735, lng: 35.84441 },
      { id: 'g3', ar: 'بوابة 3', en: 'Gate 3', match: num(3), lat: 31.97839, lng: 35.84274 },
    ],
  },
  citymall: {
    ar: 'سيتي مول',
    en: 'City Mall',
    gates: [
      { id: 'main', ar: 'المدخل الرئيسي', en: 'Main Entrance', match: MAIN, lat: 31.98002, lng: 35.83663 },
      {
        id: 'parking',
        ar: 'مدخل المواقف',
        en: 'Parking Entrance',
        match: /مواقف|موقف|باركن|باركين|كراج|جراج|parking|garage|car ?park/,
        lat: 31.97982,
        lng: 35.8375,
      },
    ],
  },
  ju: {
    ar: 'الجامعة الأردنية',
    en: 'University of Jordan',
    gates: [
      // OSM entrance=main on Queen Rania Street.
      { id: 'main', ar: 'البوابة الرئيسية', en: 'Main Gate', match: MAIN, lat: 32.01062, lng: 35.86765 },
      // OSM gate named "Northern Gate" (the team's point agrees within 16 m).
      { id: 'north', ar: 'البوابة الشمالية', en: 'North Gate', match: /شمال|north/, lat: 32.01993, lng: 35.86928 },
      // OSM bus stop «موقف باص بوابة كلية الزراعة», at the gate.
      { id: 'agri', ar: 'بوابة الزراعة', en: 'Agriculture Gate', match: /زراع|agricult/, lat: 32.00985, lng: 35.87107 },
      // Team: not on OSM.
      { id: 'eng', ar: 'بوابة الهندسة', en: 'Engineering Gate', match: /هندس|engineer/, lat: 32.0162, lng: 35.8681 },
    ],
  },
}

// «الأولى / التانية / third / two» → digits, so «البوابة التانية» and "gate 2" read the same.
const ORDINALS: [RegExp, string][] = [
  [/(?:^|\s)(?:ال)?(?:اول|اولي|واحد|first|one)(?=\s|$)/g, ' 1 '],
  [/(?:^|\s)(?:ال)?(?:ثاني|ثانيه|تاني|تانيه|اثنين|اتنين|second|two)(?=\s|$)/g, ' 2 '],
  [/(?:^|\s)(?:ال)?(?:ثالث|ثالثه|تالت|تالته|ثلاثه|تلاته|third|three)(?=\s|$)/g, ' 3 '],
]

/** Normalised gate text: Arabic spelling unified, Arabic-Indic digits and ordinals as 0-9. */
export function gateKey(text: string): string {
  let t = normalizeArabic(text).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  for (const [pattern, digit] of ORDINALS) t = t.replace(pattern, digit)
  return t.replace(/\s+/g, ' ').trim()
}

/** The landmark's gate the rider named («بوابة 2» → Mecca Mall Gate 2), or null. */
export function findGate(landmarkId: string, gateText: string): { landmark: GatedLandmark; gate: Gate } | null {
  const landmark = GATED_LANDMARKS[landmarkId]
  if (!landmark) return null
  const key = gateKey(gateText)
  const gate = landmark.gates.find((g) => g.match.test(key))
  return gate ? { landmark, gate } : null
}

// ---------------------------------------------------------------- Traffic circles

/**
 * Amman's circles on the roundabout itself (OSM `junction=roundabout` way centres). Kept as their
 * own entries so «دوار صويلح» lands on the circle, not the Sweileh district centre. The 6th Circle
 * is an interchange with no named way on OSM — add it once the team has its coordinates.
 */
export const JORDAN_CIRCLES: Landmark[] = [
  { id: 'first', name: 'الدوار الأول', en: '1st Circle', aliases: ['دوار الأول', 'دوار الاول', 'First Circle'], lat: 31.9507, lng: 35.923 },
  { id: 'second', name: 'الدوار الثاني', en: '2nd Circle', aliases: ['دوار الثاني', 'Second Circle', 'ميدان وصفي التل'], lat: 31.9515, lng: 35.9157 },
  { id: 'third', name: 'الدوار الثالث', en: '3rd Circle', aliases: ['دوار الثالث', 'Third Circle', 'ميدان الملك طلال'], lat: 31.954, lng: 35.9107 },
  { id: 'fourth', name: 'الدوار الرابع', en: '4th Circle', aliases: ['دوار الرابع', 'Fourth Circle'], lat: 31.956, lng: 35.8962 },
  { id: 'fifth', name: 'الدوار الخامس', en: '5th Circle', aliases: ['الخامس', 'دوار الخامس', 'Fifth Circle'], lat: 31.9605, lng: 35.8807 },
  { id: 'seventh', name: 'الدوار السابع', en: '7th Circle', aliases: ['السابع', 'دوار السابع', 'Seventh Circle'], lat: 31.9593, lng: 35.8576 },
  { id: 'eighth', name: 'الدوار الثامن', en: '8th Circle', aliases: ['الثامن', 'دوار الثامن', 'Eighth Circle'], lat: 31.9566, lng: 35.8472 },
  { id: 'sports', name: 'دوار المدينة الرياضية', en: 'Sports City Circle', aliases: ['المدينة الرياضية', 'Sports City'], lat: 31.9856, lng: 35.8979 },
  { id: 'waha', name: 'دوار الواحة', en: 'Al-Waha Circle', aliases: ['الواحة', 'دوار الواحه', 'Waha Circle'], lat: 31.9911, lng: 35.8685 },
  { id: 'sweileh-circle', name: 'دوار صويلح', en: 'Sweileh Circle', aliases: ['Swelih Roundabout', 'Swaileh Circle'], lat: 32.0218, lng: 35.8439 },
  // Officially «دوار الحرمين الشريفين»; everyone says «الكيلو».
  {
    id: 'kilo',
    name: 'دوار الكيلو',
    en: 'Al-Kilo Circle',
    aliases: ['الكيلو', 'دوار الحرمين', 'دوار الحرمين الشريفين', 'Kilo Circle', 'Al-Haramain Circle'],
    lat: 31.9745,
    lng: 35.8654,
  },
]
