import { Router } from 'express'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import OpenAI from 'openai'
import { config } from '../config.ts'
import { ApiError } from '../errors.ts'

// POST /api/tts — { text, lang: "ar" | "en" } → audio/mpeg. Speaks the ride confirmation the
// frontend composed. Not part of the parse / confirm contract: when it is off or fails, the
// frontend falls back to the browser's speechSynthesis.

/** A confirmation sentence is ~150 characters; the cap keeps a public demo URL from being a free TTS service. */
const MAX_CHARS = 300

const { provider } = config.tts
const openai =
  provider === 'openai' && config.tts.openaiKey
    ? new OpenAI({ apiKey: config.tts.openaiKey, timeout: 10_000, maxRetries: 0 })
    : null

/** What /api/health reports; "browser" = no server voice. */
export const ttsStatus =
  provider === 'edge'
    ? `edge ${config.tts.voiceAr} / ${config.tts.voiceEn}`
    : openai
      ? `openai ${config.tts.openaiModel}/${config.tts.openaiVoice}`
      : 'browser'

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Microsoft Edge's online neural voices (the read-aloud service; no key). */
async function edgeSpeech(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS()
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    // Slightly slower than default: calm, clear confirmation.
    const { audioStream } = tts.toStream(escapeXml(text), { rate: '-5%' })
    const chunks: Buffer[] = []
    for await (const chunk of audioStream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
  } finally {
    tts.close()
  }
}

async function openaiSpeech(text: string): Promise<Buffer> {
  const speech = await openai!.audio.speech.create({
    model: config.tts.openaiModel,
    voice: config.tts.openaiVoice,
    input: text,
    response_format: 'mp3',
  })
  return Buffer.from(await speech.arrayBuffer())
}

// Demos repeat the same few rides — keep the last answers instead of synthesising them again.
const cache = new Map<string, Buffer>()
const CACHE_SIZE = 30

export const ttsRouter = Router()

ttsRouter.post('/tts', async (req, res) => {
  if (ttsStatus === 'browser') throw new ApiError('SERVER_ERROR', 'الرد الصوتي غير مفعّل على الخادم', 501)
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (!text || text.length > MAX_CHARS) throw new ApiError('SERVER_ERROR', 'نص غير صالح', 400)
  const lang = req.body?.lang === 'en' ? 'en' : 'ar'
  const voice = provider === 'edge' ? (lang === 'en' ? config.tts.voiceEn : config.tts.voiceAr) : config.tts.openaiVoice

  const key = `${voice}|${text}`
  let audio = cache.get(key)
  if (!audio) {
    try {
      audio = provider === 'edge' ? await edgeSpeech(text, voice) : await openaiSpeech(text)
    } catch (e) {
      console.error(`[tts] ${voice} failed:`, String((e as Error)?.message ?? e).slice(0, 160))
      throw new ApiError('SERVER_ERROR', 'تعذر توليد الصوت', 502)
    }
    if (audio.length === 0) throw new ApiError('SERVER_ERROR', 'تعذر توليد الصوت', 502)
    cache.set(key, audio)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }
  res.type('audio/mpeg').set('Cache-Control', 'no-store').send(audio)
})
