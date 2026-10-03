import { toFile } from 'openai'
import { config } from '../config.ts'
import { ApiError } from '../errors.ts'
import { ai } from './openai.ts'

// Speech-to-text with Whisper (Groq whisper-large-v3, or OpenAI whisper-1).

/** Whisper infers the format from the file extension, so map the upload's MIME type. */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
}

/** Base MIME type without codec parameters ("audio/webm;codecs=opus" → "audio/webm"). */
export const baseMime = (mime: string) => mime.split(';')[0].trim().toLowerCase()
export const isSupportedAudio = (mime: string) => baseMime(mime) in EXTENSIONS

// Whisper's `prompt` biases spelling toward local landmark names and phrasing (it does not decide
// the language — that is detected from the audio). Kept short: Groq caps the prompt at 224 tokens.
// Local names (and the word «دوار», which Whisper otherwise hears as «ورد» / «دور») bias the decoder.
const ARABIC_PROMPT =
  'تطبيق حجز سيارات في الأردن، عمان، الزرقاء، إربد، العقبة، دوار الجندي، دوار الواحة، دوار الدلة، الدوار السابع، مستشفى الجامعة، طبربور، مرج الحمام، صويلح، العبدلي، مكة مول، سيتي مول.'
// Auto mode: the same Arabic context plus a short English line — the spoken language itself is
// detected from the audio, so English speech is still transcribed in English.
const BILINGUAL_PROMPT = `${ARABIC_PROMPT} Ride app in Amman, Jordan: 7th Circle, Abdali Boulevard, City Mall.`
const ENGLISH_PROMPT = 'Ride request in Amman, Jordan: take me from Rainbow Street to City Mall, Abdali Boulevard, 7th Circle.'

const promptFor = (language: string) => (language === 'ar' ? ARABIC_PROMPT : language === 'en' ? ENGLISH_PROMPT : BILINGUAL_PROMPT)

const ARABIC = /[؀-ۿ]/g
const LATIN = /[A-Za-z]/g
const count = (s: string, script: RegExp) => (s.match(script) ?? []).length

/**
 * Whisper sometimes appends a translation of what was said («وديني من جامعة الإسراء…. I'm going
 * from Isra'a University to…»), so the app would answer in the wrong language. Keep only the
 * sentences in the language it heard; English place names inside an Arabic sentence stay.
 */
export function keepSpokenLanguage(text: string, detected?: string): string {
  const sentences = text.split(/(?<=[.!?؟])\s+/).filter(Boolean)
  if (sentences.length < 2) return text
  const lang = detected?.toLowerCase()
  const spoken: RegExp =
    lang === 'arabic' || lang === 'ar' ? ARABIC
    : lang === 'english' || lang === 'en' ? LATIN
    // No language reported: the first sentence is what the rider said.
    : count(sentences[0], ARABIC) >= count(sentences[0], LATIN) ? ARABIC : LATIN
  const other = spoken === ARABIC ? LATIN : ARABIC
  const kept = sentences.filter((s) => count(s, spoken) >= count(s, other))
  if (kept.length === 0 || kept.length === sentences.length) return text
  console.log(`[stt] dropped ${sentences.length - kept.length} sentence(s) not in the spoken language (${lang ?? 'guessed'})`)
  return kept.join(' ')
}

export async function transcribe(audio: Buffer, mimeType: string): Promise<string> {
  if (!ai) {
    console.error('[stt] no GROQ_API_KEY / OPENAI_API_KEY set — cannot transcribe audio')
    throw new ApiError('STT_FAILED')
  }
  const mime = baseMime(mimeType)
  const file = await toFile(audio, `recording.${EXTENSIONS[mime] ?? 'webm'}`, { type: mime })

  try {
    const result = await ai.audio.transcriptions.create({
      file,
      model: config.ai.sttModel,
      // "auto": no `language` — Whisper detects Arabic or English from the audio.
      ...(config.ai.sttLanguage === 'auto' ? {} : { language: config.ai.sttLanguage }),
      prompt: promptFor(config.ai.sttLanguage),
      // verbose_json also returns the language Whisper detected from the audio.
      response_format: 'verbose_json',
    })
    const text = keepSpokenLanguage(result.text.trim(), result.language)
    if (!text) throw new ApiError('STT_FAILED')
    return text
  } catch (e) {
    if (e instanceof ApiError) throw e
    console.error(`[stt] ${config.ai.sttModel} request failed:`, (e as Error).message)
    throw new ApiError('STT_FAILED')
  }
}
