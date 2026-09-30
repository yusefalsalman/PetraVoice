// Level-1 geocoding: curated Jordanian landmarks with colloquial and English aliases.
// Coordinates from OpenStreetMap (Nominatim). `name` / `en` are the canonical names returned
// to Arabic / English requests. Seeded into SQLite on startup (see db/database.ts).

export interface Landmark {
  id: string
  name: string
  en: string
  aliases: string[]
  lat: number
  lng: number
}

export const LANDMARKS: Landmark[] = [
  { id: 'waha', name: 'دوار الواحة', en: 'Al-Waha Circle', aliases: ['الواحة', 'دوار الواحه', 'Waha Circle'], lat: 31.9871, lng: 35.8712 },
  { id: 'istiklal', name: 'مستشفى الاستقلال', en: 'Istiklal Hospital', aliases: ['الاستقلال', 'مستشفى الإستقلال'], lat: 31.9945, lng: 35.9102 },
  // On OSM only as "Jordan University Hospital" — Arabic searches find nothing.
  {
    id: 'juh',
    name: 'مستشفى الجامعة الأردنية',
    en: 'Jordan University Hospital',
    aliases: ['مستشفى الجامعة', 'مستشفى الجامعه الاردنيه'],
    lat: 32.0065,
    lng: 35.8745,
  },
  {
    id: 'ju',
    name: 'الجامعة الأردنية - البوابة الشمالية',
    en: 'University of Jordan – North Gate',
    aliases: ['الجامعة الأردنية', 'الأردنية', 'University of Jordan', 'UJ'],
    lat: 32.0141,
    lng: 35.8701,
  },
  {
    id: 'asu',
    name: 'جامعة العلوم التطبيقية',
    en: 'Applied Science University',
    aliases: ['العلوم التطبيقية', 'التطبيقية', 'ASU'],
    lat: 32.0318,
    lng: 35.8794,
  },
  { id: 'interior', name: 'دوار الداخلية', en: 'Interior Circle', aliases: ['الداخلية', 'Interior Ministry Circle'], lat: 31.9725, lng: 35.9098 },
  {
    id: 'abdali',
    name: 'العبدلي بوليفارد',
    en: 'Abdali Boulevard',
    aliases: ['العبدلي', 'البوليفارد', 'بوليفارد', 'Abdali', 'The Boulevard'],
    lat: 31.9649,
    lng: 35.9041,
  },
  { id: 'citymall', name: 'سيتي مول', en: 'City Mall', aliases: [], lat: 31.9805, lng: 35.838 },
  { id: 'mecca', name: 'مكة مول', en: 'Mecca Mall', aliases: ['مكه مول', 'Makkah Mall'], lat: 31.9777, lng: 35.8439 },
  { id: 'taj', name: 'تاج مول', en: 'Taj Mall', aliases: [], lat: 31.9412, lng: 35.8881 },
  { id: 'fifth', name: 'الدوار الخامس', en: '5th Circle', aliases: ['الخامس', 'دوار الخامس', 'Fifth Circle'], lat: 31.9607, lng: 35.8805 },
  { id: 'seventh', name: 'الدوار السابع', en: '7th Circle', aliases: ['السابع', 'دوار السابع', 'Seventh Circle'], lat: 31.9594, lng: 35.8576 },
  { id: 'eighth', name: 'الدوار الثامن', en: '8th Circle', aliases: ['الثامن', 'دوار الثامن', 'Eighth Circle'], lat: 31.957, lng: 35.8471 },
  {
    id: 'roman',
    name: 'المدرج الروماني - وسط البلد',
    en: 'Roman Theatre – Downtown',
    aliases: ['المدرج الروماني', 'وسط البلد', 'البلد', 'Downtown', 'Roman Theatre', 'Roman Theater'],
    lat: 31.9516,
    lng: 35.9393,
  },
  {
    id: 'citadel',
    name: 'جبل القلعة',
    en: 'Amman Citadel',
    aliases: ['القلعة', 'Citadel', 'The Citadel', 'Jabal al-Qal’a'],
    lat: 31.9545,
    lng: 35.9367,
  },
  {
    id: 'airport',
    name: 'مطار الملكة علياء الدولي',
    en: 'Queen Alia International Airport',
    aliases: ['مطار الملكة علياء', 'المطار', 'Queen Alia Airport', 'Airport', 'the airport', 'QAIA'],
    lat: 31.7238,
    lng: 36.0072,
  },
  { id: 'sports', name: 'دوار المدينة الرياضية', en: 'Sports City Circle', aliases: ['المدينة الرياضية', 'Sports City'], lat: 31.9854, lng: 35.8976 },
  { id: 'jordanhosp', name: 'مستشفى الأردن', en: 'Jordan Hospital', aliases: [], lat: 31.9606, lng: 35.8997 },
  { id: 'rainbow', name: 'شارع الرينبو', en: 'Rainbow Street', aliases: ['الرينبو', 'Rainbow St'], lat: 31.9493, lng: 35.9303 },
  { id: 'abdoun', name: 'دوار عبدون', en: 'Abdoun Circle', aliases: ['عبدون', 'Abdoun'], lat: 31.9488, lng: 35.8925 },
  { id: 'shmeisani', name: 'الشميساني', en: 'Shmeisani', aliases: [], lat: 31.9735, lng: 35.8969 },
  { id: 'khalda', name: 'دوار خلدا', en: 'Khalda Circle', aliases: ['خلدا', 'Khalda'], lat: 31.9947, lng: 35.8303 },
  { id: 'sweifieh', name: 'الصويفية', en: 'Sweifieh', aliases: ['Swefieh'], lat: 31.9584, lng: 35.8639 },

  // Universities across Jordan — several exist on OSM only under their English name,
  // so an Arabic Nominatim search can't find them.
  { id: 'psut', name: 'جامعة الأميرة سمية للتكنولوجيا', en: 'Princess Sumaya University for Technology', aliases: ['جامعة الأميرة سمية', 'سمية', 'PSUT'], lat: 32.0231, lng: 35.8768 },
  { id: 'gju', name: 'الجامعة الألمانية الأردنية', en: 'German Jordanian University', aliases: ['الألمانية', 'GJU'], lat: 31.777, lng: 35.8014 },
  { id: 'bau', name: 'جامعة البلقاء التطبيقية', en: 'Al-Balqa Applied University', aliases: ['البلقاء التطبيقية', 'جامعة البلقاء'], lat: 32.0245, lng: 35.7172 },
  { id: 'hu', name: 'الجامعة الهاشمية', en: 'Hashemite University', aliases: ['الهاشمية'], lat: 32.1031, lng: 36.1859 },
  { id: 'yu', name: 'جامعة اليرموك', en: 'Yarmouk University', aliases: ['اليرموك'], lat: 32.5372, lng: 35.8555 },
  { id: 'just', name: 'جامعة العلوم والتكنولوجيا الأردنية', en: 'Jordan University of Science and Technology', aliases: ['جامعة التكنولوجيا', 'التكنولوجيا', 'التكنو'], lat: 32.4934, lng: 35.9899 },
  { id: 'aabu', name: 'جامعة آل البيت', en: 'Al al-Bayt University', aliases: ['آل البيت'], lat: 32.3337, lng: 36.25 },
  { id: 'mutah', name: 'جامعة مؤتة', en: 'Mutah University', aliases: ['مؤتة'], lat: 31.0927, lng: 35.7177 },
  { id: 'ttu', name: 'جامعة الطفيلة التقنية', en: 'Tafila Technical University', aliases: ['جامعة الطفيلة', 'الطفيلة التقنية'], lat: 30.8397, lng: 35.6442 },
  { id: 'ahu', name: 'جامعة الحسين بن طلال', en: 'Al-Hussein Bin Talal University', aliases: ['الحسين بن طلال'], lat: 30.2594, lng: 35.6843 },
]

/** Vague words that match more than one landmark → the «قصدك؟» choice (exactly two). */
export const AMBIGUOUS_TERMS: { term: string; ids: [string, string] }[] = [
  { term: 'الجامعة', ids: ['ju', 'asu'] },
  { term: 'المول', ids: ['citymall', 'mecca'] },
  { term: 'مول', ids: ['citymall', 'mecca'] },
  { term: 'جامعة', ids: ['ju', 'asu'] },
  { term: 'the university', ids: ['ju', 'asu'] },
  { term: 'university', ids: ['ju', 'asu'] },
  { term: 'the mall', ids: ['citymall', 'mecca'] },
  { term: 'mall', ids: ['citymall', 'mecca'] },
]

/**
 * The rider's default pickup when none is said ("current location"). Must match
 * frontend/src/lib/location.ts — this exact Arabic string is a marker the frontend
 * recognises and shows translated, so it is returned as-is for both languages.
 */
export const CURRENT_LOCATION = { name: 'موقعي الحالي (عمان)', lat: 31.9725, lng: 35.9098 } as const

/** Phrases meaning "where I am now". */
export const CURRENT_LOCATION_PHRASES = [
  'موقعي',
  'موقعي الحالي',
  'مكاني',
  'هون',
  'هنا',
  'current location',
  'my location',
  'here',
  'where i am',
]
