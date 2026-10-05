import { create } from 'zustand'
import type { RideType } from '../types/api'
import { NOTES_SEPARATOR, splitNotes } from './location'

// UI copy only. Place names and backend error messages come from the API and are
// shown as received; the API contract ({ pickup, dropoff }) is the same in both languages.

export type Lang = 'ar' | 'en'

const plural = (n: number) => (n >= 3 && n <= 10 ? 'دقائق' : 'دقيقة')

const ar = {
  appName: 'PetraRide',
  switchLang: 'Switch to English',
  sheetLabel: 'تفاصيل الرحلة',
  sheetHide: 'إخفاء التفاصيل لعرض الخريطة كاملة',
  sheetShow: 'إظهار تفاصيل الرحلة',
  voiceOn: 'تشغيل الرد الصوتي',
  voiceOff: 'كتم الرد الصوتي',

  title: 'إلى أين تريد الذهاب؟',
  listeningTitle: 'أنا أستمع إليك…',
  popular: 'وجهات شائعة',
  cta: 'اضغط للتحدث بمشوارك',
  listening: 'أستمع إليك…',
  stopAndSend: 'إيقاف التسجيل وإرسال الطلب',
  inlineMic: 'قل وجهتك بالصوت',
  hintIdle: 'قل مثلاً: «وصلني من دوار الواحة لمستشفى الاستقلال»',
  hintRecording: 'اضغط للإيقاف والإرسال، أو توقّف عن الكلام 3 ثوانٍ',

  pickupLabel: 'من أين؟',
  dropoffLabel: 'إلى أين؟',
  currentLocation: 'موقعي الحالي (عمان)',
  dropoffPlaceholder: 'إلى أين؟',
  findRide: 'ابحث عن رحلة',
  updateRoute: 'تحديث المسار',
  resolving: 'جاري تحديد الموقع…',
  confidence: (pct: number) => `نسبة الثقة ${pct} بالمئة`,

  rideTypeLegend: 'نوع الرحلة',
  rideTypes: { economy: 'اقتصادي', comfort: 'مريح', xl: 'XL عائلي' } as Record<RideType, string>,
  seats: (n: number) => `${n} ركاب`,
  jodShort: 'د.أ',

  yourRequest: 'طلبك:',
  confirm: 'تأكيد الرحلة',
  confirming: 'جاري التأكيد…',
  safetyNote: 'لن يتم طلب أي رحلة قبل أن تضغط «تأكيد الرحلة»',
  missingPickup: 'حدّد نقطة الانطلاق للمتابعة',
  missingDropoff: 'حدّد الوجهة للمتابعة',
  startOver: 'إلغاء والبدء من جديد',

  fareTitle: 'السعر التقديري',
  jod: 'دينار',
  fareTbd: 'يُحدَّد عند تأكيد الرحلة',
  minutes: (n: number) => `${n} ${plural(n)}`,
  km: (n: number) => `${n} كم`,

  processing: 'جاري فهم طلبك…',
  processingSub: 'نحدد نقطة الانطلاق والوجهة ونحسب السعر',
  cancel: 'إلغاء',

  didYouMean: 'قصدك؟',
  pickup: 'نقطة الانطلاق',
  dropoff: 'الوجهة',
  neither: 'لا هذا ولا ذاك — أعد التسجيل',
  sayInstead: 'أو قول اسمها بصوتك',

  booked: 'تم تأكيد رحلتك!',
  driverOnWay: 'السائق في الطريق إليك، يصل خلال',
  from: 'من:',
  to: 'إلى:',
  bookingId: 'رقم الحجز:',
  newRide: 'طلب رحلة جديدة',

  /** Only used for errors raised in the browser; API errors keep the backend's Arabic message. */
  errors: {
    MIC_DENIED: 'لم يتم السماح باستخدام الميكروفون. فعّل الإذن من إعدادات المتصفح ثم حاول مرة أخرى.',
    MIC_UNSUPPORTED: 'المتصفح لا يدعم تسجيل الصوت. جرّب متصفحاً آخر أو اكتب طلبك.',
    MIC_UNAVAILABLE: 'تعذر الوصول إلى الميكروفون. تأكد من توصيله وحاول مرة أخرى.',
    INVALID_AUDIO: 'لم يتم تسجيل أي صوت، حاول مرة أخرى',
    NO_SPEECH: 'لم أسمع صوتاً. اضغط على الميكروفون وتحدّث بوضوح.',
  } as Record<string, string>,
}

type Strings = typeof ar

const en: Strings = {
  appName: 'PetraRide',
  switchLang: 'التبديل إلى العربية',
  sheetLabel: 'Trip details',
  sheetHide: 'Hide details to see the full map',
  sheetShow: 'Show trip details',
  voiceOn: 'Turn spoken confirmation on',
  voiceOff: 'Mute spoken confirmation',

  title: 'Where to?',
  listeningTitle: "I'm listening…",
  popular: 'Popular destinations',
  cta: 'Tap to Speak Destination',
  listening: 'Listening…',
  stopAndSend: 'Stop recording and send',
  inlineMic: 'Say your destination',
  hintIdle: 'Try: "Take me from Al-Waha Circle to Istiklal Hospital"',
  hintRecording: 'Tap to stop and send, or pause for 3 seconds',

  pickupLabel: 'From?',
  dropoffLabel: 'Where to?',
  currentLocation: 'Current location (Amman)',
  dropoffPlaceholder: 'Where to?',
  findRide: 'Find a ride',
  updateRoute: 'Update route',
  resolving: 'Finding location…',
  confidence: (pct: number) => `Confidence ${pct} percent`,

  rideTypeLegend: 'Ride type',
  rideTypes: { economy: 'Economy', comfort: 'Comfort', xl: 'Family XL' },
  seats: (n: number) => `${n} seats`,
  jodShort: 'JOD',

  yourRequest: 'Your request:',
  confirm: 'Confirm ride',
  confirming: 'Confirming…',
  safetyNote: 'No ride is booked until you tap "Confirm ride"',
  missingPickup: 'Set a pickup point to continue',
  missingDropoff: 'Set a destination to continue',
  startOver: 'Cancel and start over',

  fareTitle: 'Estimated fare',
  jod: 'JOD',
  fareTbd: 'Set when you confirm',
  minutes: (n: number) => `${n} min`,
  km: (n: number) => `${n} km`,

  processing: 'Understanding your request…',
  processingSub: 'Finding your pickup, destination and fare',
  cancel: 'Cancel',

  didYouMean: 'Did you mean?',
  pickup: 'Pickup',
  dropoff: 'Destination',
  neither: 'Neither — try again',
  sayInstead: 'Or say its name',

  booked: 'Your ride is confirmed!',
  driverOnWay: 'Your driver is on the way, arriving in',
  from: 'From:',
  to: 'To:',
  bookingId: 'Booking ID:',
  newRide: 'Book a new ride',

  errors: {
    MIC_DENIED: 'Microphone access was blocked. Allow it in your browser settings and try again.',
    MIC_UNSUPPORTED: "This browser can't record audio. Try another browser or type your request.",
    MIC_UNAVAILABLE: "Couldn't access the microphone. Check it's connected and try again.",
    INVALID_AUDIO: 'No audio was recorded. Please try again.',
    NO_SPEECH: "I didn't hear anything. Tap the mic and speak clearly.",
    STT_FAILED: "Couldn't understand the audio. Please try again.",
    NO_LOCATION_FOUND: "Couldn't recognise one of the places. Try a well-known landmark nearby.",
    SERVER_ERROR: 'Something went wrong on the server. Please try again.',
  },
}

const STRINGS: Record<Lang, Strings> = { ar, en }
const STORAGE_KEY = 'pv-lang'

function readSaved(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar'
  } catch {
    return 'ar'
  }
}

function applyToDocument(lang: Lang) {
  const html = document.documentElement
  html.lang = lang
  html.dir = lang === 'ar' ? 'rtl' : 'ltr'
  document.title = STRINGS[lang].appName
}

export const useLang = create<{ lang: Lang; setLang: (lang: Lang) => void }>()((set) => ({
  lang: readSaved(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // private mode etc. — the switch still works for this session
    }
    applyToDocument(lang)
    set({ lang })
  },
}))

applyToDocument(useLang.getState().lang)

/** Current UI strings. */
export function useT(): Strings {
  return STRINGS[useLang((s) => s.lang)]
}

/**
 * Message for an error. Browser-side codes (mic, silence) are always translated; API errors
 * show the backend's Arabic message in Arabic mode and a translation by code in English.
 */
export function errorText(t: Strings, error: { code: string; message: string }): string {
  if (error.code in ar.errors) return t.errors[error.code]
  if (t === ar) return error.message
  return t.errors[error.code] ?? error.message
}

/**
 * English display names for known Amman places, keyed by the Arabic name the API returns.
 * Display-only, for Arabic names shown in the English UI (the backend already answers English
 * requests with English names). Unknown places are shown as received.
 */
const PLACE_NAMES_EN: Record<string, string> = {
  'دوار الواحة': 'Al-Waha Circle',
  'مستشفى الاستقلال': 'Istiklal Hospital',
  'الجامعة الأردنية - البوابة الشمالية': 'University of Jordan – North Gate',
  'جامعة العلوم التطبيقية': 'Applied Science University',
  'دوار الداخلية': 'Interior Circle',
  'العبدلي بوليفارد': 'Abdali Boulevard',
  'سيتي مول': 'City Mall',
  'مكة مول': 'Mecca Mall',
  'تاج مول': 'Taj Mall',
  'الدوار السابع': '7th Circle',
  'الدوار الأول': '1st Circle',
  'الدوار الثاني': '2nd Circle',
  'الدوار الثالث': '3rd Circle',
  'الدوار الرابع': '4th Circle',
  'دوار صويلح': 'Sweileh Circle',
  'جامعة البترا': 'University of Petra',
  'جامعة الإسراء': 'Isra University',
  'جامعة الزيتونة': 'Al-Zaytoonah University of Jordan',
  'مستشفى الخالدي': 'Al-Khalidi Hospital',
  'المستشفى التخصصي': 'The Specialty Hospital',
  'مدارس الكلية العلمية الإسلامية': 'Islamic Scientific College School',
  'مدارس النظم الحديثة': 'Modern Systems Schools',
  'المدرسة الأهلية للبنات': 'Ahliyyah School for Girls',
  'العبدلي مول': 'Abdali Mall',
  'جاليريا مول': 'Galleria Mall',
  // Cities and towns across Jordan
  'العقبة': 'Aqaba',
  'الكرك': 'Karak',
  'معان': 'Ma’an',
  'الطفيلة': 'Tafila',
  'المفرق': 'Mafraq',
  'إربد': 'Irbid',
  'الرمثا': 'Ramtha',
  'الزرقاء': 'Zarqa',
  'الرصيفة': 'Russeifa',
  'السلط': 'Salt',
  'مادبا': 'Madaba',
  'جرش': 'Jerash',
  'عجلون': 'Ajloun',
  'البتراء (وادي موسى)': 'Petra (Wadi Musa)',
  'وادي رم': 'Wadi Rum',
  'الأزرق': 'Azraq',
  'الشوبك': 'Shoubak',
  'البحر الميت': 'Dead Sea',
  'الجامعة الأردنية': 'University of Jordan',
  'المدرج الروماني - وسط البلد': 'Roman Theatre – Downtown',
  'مطار الملكة علياء الدولي': 'Queen Alia International Airport',
  'دوار المدينة الرياضية': 'Sports City Circle',
  'مستشفى الأردن': 'Jordan Hospital',
  'شارع الرينبو': 'Rainbow Street',
  'دوار عبدون': 'Abdoun Circle',
  الشميساني: 'Shmeisani',
  'دوار خلدا': 'Khalda Circle',
  الصويفية: 'Sweifieh',
  'جامعة الأميرة سمية للتكنولوجيا': 'Princess Sumaya University for Technology',
  'الجامعة الألمانية الأردنية': 'German Jordanian University',
  'جامعة البلقاء التطبيقية': 'Al-Balqa Applied University',
  'الجامعة الهاشمية': 'Hashemite University',
  'جامعة اليرموك': 'Yarmouk University',
  'جامعة العلوم والتكنولوجيا الأردنية': 'Jordan University of Science and Technology',
  'جامعة آل البيت': 'Al al-Bayt University',
  'جامعة مؤتة': 'Mutah University',
  'جامعة الطفيلة التقنية': 'Tafila Technical University',
  'جامعة الحسين بن طلال': 'Al-Hussein Bin Talal University',
}

/** Name to show for a place in the current language. */
export function placeName(name: string, lang: Lang): string {
  // Translate the landmark only; a gate note after « • » stays as the rider said it.
  const { main, notes } = splitNotes(name)
  const shown = lang === 'en' ? (PLACE_NAMES_EN[main] ?? main) : main
  return notes ? `${shown}${NOTES_SEPARATOR}${notes}` : shown
}

/** Neighbourhood shown under a «قصدك؟» option, keyed by the Arabic name the API returns. */
const PLACE_AREAS: Record<string, { ar: string; en: string }> = {
  'الجامعة الأردنية - البوابة الشمالية': { ar: 'الجبيهة', en: 'Al-Jubeiha' },
  'جامعة العلوم التطبيقية': { ar: 'شفا بدران', en: 'Shafa Badran' },
  'جامعة البترا': { ar: 'طريق المطار', en: 'Airport Road' },
  'جامعة الإسراء': { ar: 'طريق المطار', en: 'Airport Road' },
  'جامعة الزيتونة': { ar: 'طريق المطار', en: 'Airport Road' },
  'مستشفى الجامعة الأردنية': { ar: 'الجبيهة', en: 'Al-Jubeiha' },
  'مستشفى الخالدي': { ar: 'جبل عمان', en: 'Jabal Amman' },
  'المستشفى التخصصي': { ar: 'الشميساني', en: 'Shmeisani' },
  'مستشفى الأردن': { ar: 'قرب الدوار الرابع', en: 'near 4th Circle' },
  'مدارس الكلية العلمية الإسلامية': { ar: 'جبل عمان', en: 'Jabal Amman' },
  'مدارس النظم الحديثة': { ar: 'تلاع العلي', en: "Tla'a Al-Ali" },
  'المدرسة الأهلية للبنات': { ar: 'جبل عمان', en: 'Jabal Amman' },
  'تاج مول': { ar: 'عبدون', en: 'Abdoun' },
  'العبدلي مول': { ar: 'العبدلي', en: 'Abdali' },
  'جاليريا مول': { ar: 'الصويفية', en: 'Sweifieh' },
}

/** Area hint for a place name in either language, or null. */
export function placeArea(name: string, lang: Lang): string | null {
  const main = splitNotes(name).main
  const key = main in PLACE_AREAS ? main : Object.keys(PLACE_NAMES_EN).find((k) => PLACE_NAMES_EN[k] === main)
  return key && PLACE_AREAS[key] ? PLACE_AREAS[key][lang] : null
}

/** Popular destinations, shown and sent in the UI language. */
export const QUICK_DESTINATIONS: { query: string; label: Record<Lang, string> }[] = [
  { query: 'العبدلي بوليفارد', label: { ar: 'العبدلي بوليفارد', en: 'Abdali Boulevard' } },
  { query: 'سيتي مول', label: { ar: 'سيتي مول', en: 'City Mall' } },
  { query: 'الدوار السابع', label: { ar: 'الدوار السابع', en: '7th Circle' } },
  { query: 'مطار الملكة علياء الدولي', label: { ar: 'مطار الملكة علياء الدولي', en: 'Queen Alia Airport' } },
]
