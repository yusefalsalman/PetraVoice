import { create } from 'zustand'
import type { Place, RideType } from '../types/api'
import { placeName, type Lang } from './i18n'
import { isCurrentLocation, splitNotes } from './location'

// Spoken ride confirmation: «أبشر، جهزتلك رحلة اقتصادية من مكة مول بوابة 2 إلى دوار صويلح…».
// Voice: the backend's /api/tts (Edge neural male voices: Hamed / Christopher) when it is on,
// otherwise — or if it is slow — the browser's own speechSynthesis with a male voice.
// It only describes the ride — booking still needs the rider's tap on «تأكيد الرحلة».

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
const STORAGE_KEY = 'pv-voice'

/** Rider's mute switch, remembered per browser. */
export const useVoice = create<{ muted: boolean; toggle: () => void }>()((set, get) => ({
  muted: (() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'off'
    } catch {
      return false
    }
  })(),
  toggle: () => {
    const muted = !get().muted
    try {
      localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on')
    } catch {
      // private mode — the switch still works for this session
    }
    if (muted) stopSpeaking()
    set({ muted })
  },
}))

/**
 * Language the rider spoke or typed in: the script they started with. «وصلني على City Mall» is
 * Arabic with an English name; "Take me to مكة مول" is English. UI language when there's no text.
 */
export function speechLang(transcript: string, fallback: Lang): Lang {
  const first = transcript.match(/[؀-ۿA-Za-z]/)?.[0]
  if (!first) return fallback
  return /[A-Za-z]/.test(first) ? 'en' : 'ar'
}

// ---------------------------------------------------------------- The sentence

/** «مكة مول • بوابة 2» → «مكة مول بوابة 2»; approximate labels lose their «(… - موقع تقريبي)». */
function spokenPlace(p: Place, lang: Lang): string {
  if (isCurrentLocation(p.name)) return lang === 'ar' ? 'موقعك الحالي' : 'your current location'
  const { main, notes } = splitNotes(placeName(p.name, lang))
  const clean = main.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+[-–]\s+/g, ' ')
  return notes ? `${clean} ${notes}` : clean
}

/** 2.7 → "2.70" — the fare as the confirm screen shows it. */
const price = (amount: number) => amount.toFixed(2)

const RIDE_AR: Record<RideType, string> = { economy: 'اقتصادية', comfort: 'مريحة', xl: 'عائلية' }
const RIDE_EN: Record<RideType, string> = { economy: 'an Economy', comfort: 'a Comfort', xl: 'a Family XL' }

export interface Confirmation {
  pickup: Place
  dropoff: Place
  rideType: RideType
  /** The fare the confirm screen shows for this ride type. */
  fare: number
}

export function confirmationText(c: Confirmation, lang: Lang): string {
  const from = spokenPlace(c.pickup, lang)
  const to = spokenPlace(c.dropoff, lang)
  if (lang === 'ar') {
    return `أبشر، جهزتلك رحلة ${RIDE_AR[c.rideType]} من ${from} إلى ${to}. التكلفة التقديرية ${price(c.fare)} دينار.`
  }
  return `All set! I've lined up ${RIDE_EN[c.rideType]} ride from ${from} to ${to}. Estimated fare is ${price(c.fare)} JOD.`
}

// ---------------------------------------------------------------- «قصدك؟» prompt

export type PlaceCategory = 'university' | 'hospital' | 'school' | 'mall'

const CATEGORY_WORDS: [PlaceCategory, RegExp][] = [
  ['university', /جامعة|university/i],
  ['hospital', /مستشفى|hospital/i],
  ['school', /مدرسة|مدارس|school/i],
  ['mall', /مول|mall/i],
]
const CATEGORY_AR: Record<PlaceCategory, { word: string; to: string }> = {
  university: { word: 'جامعة', to: 'عليها' },
  hospital: { word: 'مستشفى', to: 'عليه' },
  school: { word: 'مدرسة', to: 'عليها' },
  mall: { word: 'مول', to: 'عليه' },
}

/** The kind of place every option is («الجامعة» → five universities), or null for mixed options. */
export function optionsCategory(names: string[]): PlaceCategory | null {
  return CATEGORY_WORDS.find(([, re]) => names.length > 0 && names.every((n) => re.test(n)))?.[0] ?? null
}

/** Heading and spoken question for the choice screen: «أي جامعة حاب تروح عليها؟…». */
export function choicePrompt(category: PlaceCategory | null, field: 'pickup' | 'dropoff', lang: Lang) {
  if (lang === 'ar') {
    if (!category) return { heading: 'قصدك؟', spoken: 'قصدك وين بالضبط؟ اختار من الخيارات التالية.' }
    const { word, to } = CATEGORY_AR[category]
    return field === 'pickup'
      ? { heading: `من أي ${word}؟`, spoken: `من أي ${word} بدك نوخذك؟ اختار من الخيارات التالية.` }
      : { heading: `أي ${word}؟`, spoken: `أي ${word} حاب تروح ${to}؟ اختار من الخيارات التالية.` }
  }
  if (!category) return { heading: 'Did you mean?', spoken: 'Which one did you mean? Pick one of the options below.' }
  return field === 'pickup'
    ? { heading: `Which ${category}?`, spoken: `Which ${category} should we pick you up from? Pick one of the options below.` }
    : { heading: `Which ${category}?`, spoken: `Which ${category} would you like to go to? Pick one of the options below.` }
}

// ---------------------------------------------------------------- Playback

/**
 * Whether the backend has a TTS key — read once from /api/health ({ tts: "browser" | "openai …" }),
 * so a server without one is never sent a request that fails with 501.
 */
let serverTts: Promise<boolean> | null = null
function hasServerTts(): Promise<boolean> {
  if (USE_MOCK) return Promise.resolve(false)
  serverTts ??= fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((h: { tts?: string } | null) => typeof h?.tts === 'string' && h.tts !== 'browser')
    .catch(() => false)
  return serverTts
}

// iOS (Safari and Chrome — both WebKit) only plays sound started inside a tap. Our confirmation
// starts seconds after the tap, so on the first tap we "unlock" one audio element (play a silent
// clip) and the speech engine (an empty utterance), and later reuse that same element.
let player: HTMLAudioElement | null = null
let unlocked = false
let playingUrl: string | null = null
let playId = 0

/** 0.05 s of silence as a WAV — built here so no asset or base64 blob is needed. */
function silentWav(): string {
  const samples = 400
  const buf = new ArrayBuffer(44 + samples)
  const v = new DataView(buf)
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF'); v.setUint32(4, 36 + samples, true); text(8, 'WAVE')
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  text(36, 'data'); v.setUint32(40, samples, true)
  new Uint8Array(buf, 44).fill(128) // 8-bit PCM silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

function unlockAudio() {
  if (unlocked) return
  unlocked = true
  player ??= new Audio()
  player.setAttribute('playsinline', '')
  player.src = silentWav()
  player.play().catch(() => {
    unlocked = false // not a qualifying gesture — try again on the next tap
  })
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    window.speechSynthesis.speak(u)
  }
}

if (typeof document !== 'undefined') {
  // touchend / click are the events iOS accepts as "the user started playback".
  for (const type of ['touchend', 'click'] as const) {
    document.addEventListener(type, unlockAudio, { capture: true, passive: true })
  }
}

export function stopSpeaking() {
  playId++
  player?.pause()
  if (playingUrl) URL.revokeObjectURL(playingUrl)
  playingUrl = null
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

export async function speak(text: string, lang: Lang): Promise<void> {
  stopSpeaking()
  const id = playId
  if (useVoice.getState().muted) return

  const useServer = await hasServerTts()
  if (id !== playId) return
  if (useServer) {
    try {
      const res = await fetch(`${API_BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
        // Slower than this and the browser voice speaks instead, while the screen is still fresh.
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob())
        if (id !== playId) return URL.revokeObjectURL(url) // stopped or replaced meanwhile
        // The element unlocked by the rider's tap (a fresh `new Audio()` is blocked on iOS).
        player ??= new Audio()
        playingUrl = url
        player.src = url
        await player.play()
        return
      }
    } catch {
      // network / timeout / autoplay refused → the browser voice below
    }
    if (id !== playId) return
  }
  await speakWithBrowser(text, lang, id)
}

// Known male voices (Windows / Edge "Natural", macOS, Android, Chrome) and female ones to avoid.
const MALE = /\bmale\b|naayf|hamed|taim|shakir|fahed|tarik|maged|omar|guy|davis|david|mark|james|christopher|eric|roger|andrew|brian|daniel|fred|alex|ryan|thomas|george/i
const FEMALE = /female|hoda|zariyah|sana|salma|amany|layla|mouna|aria|jenny|zira|samantha|susan|hazel|libby|sonia|emma|ava|michelle|karen|moira|tessa|fiona|victoria|google us english$/i

function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  // Chrome loads voices asynchronously.
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices())
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1000)
  })
}

/**
 * Preferred voices, best first: Microsoft's male "Natural" voices (Edge ships them; Chrome on
 * Windows only lists the voices installed in Windows). Matched by name substring.
 */
const PREFERRED: Record<Lang, string[]> = {
  ar: ['Hamed', 'Shakir', 'Taim', 'Naayf'],
  en: ['Andrew', 'Guy', 'Christopher', 'Eric', 'Davis', 'Brian', 'David'],
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | null {
  const prefs = lang === 'ar' ? ['ar-jo', 'ar-sa', 'ar'] : ['en-us', 'en-gb', 'en']
  const named = PREFERRED[lang]
  let best: { v: SpeechSynthesisVoice; score: number } | null = null
  for (const v of voices) {
    const tag = v.lang.toLowerCase().replace('_', '-')
    const rank = prefs.findIndex((p) => tag.startsWith(p))
    if (rank < 0) continue
    const preferred = named.findIndex((n) => v.name.includes(n))
    const score =
      (preferred >= 0 ? 100 + (named.length - preferred) * 10 : 0) +
      (prefs.length - rank) * 10 +
      (MALE.test(v.name) ? 8 : 0) -
      (FEMALE.test(v.name) ? 8 : 0) +
      (/natural|online|neural|enhanced|premium/i.test(v.name) ? 4 : 0)
    if (!best || score > best.score) best = { v, score }
  }
  return best?.v ?? null
}

async function speakWithBrowser(text: string, lang: Lang, id: number) {
  if (!('speechSynthesis' in window)) return
  const voices = await voicesReady()
  if (id !== playId) return
  const voice = pickVoice(voices, lang)
  // A voice list without this language would read Arabic with an English voice — stay silent.
  if (!voice && voices.length) {
    console.info(`[speech] no ${lang} voice installed in this browser — skipping the spoken confirmation`)
    return
  }
  if (voice && !PREFERRED[lang].some((n) => voice.name.includes(n))) {
    console.info(`[speech] using "${voice.name}" — open the app in Microsoft Edge for the natural male voices (${PREFERRED[lang].slice(0, 2).join(' / ')})`)
  }
  const u = new SpeechSynthesisUtterance(text)
  if (voice) u.voice = voice
  u.lang = voice?.lang ?? (lang === 'ar' ? 'ar-JO' : 'en-US')
  u.rate = lang === 'ar' ? 0.95 : 1
  u.pitch = 0.9
  window.speechSynthesis.speak(u)
}
