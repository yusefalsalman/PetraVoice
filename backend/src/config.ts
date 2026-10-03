// Runtime configuration from environment variables (and ./.env when present).

try {
  process.loadEnvFile()
} catch {
  // no .env file — rely on the real environment
}

const env = (key: string, fallback: string) => process.env[key]?.trim() || fallback
const optional = (value: string) => (value === 'none' ? null : value)

// AI provider: Groq (OpenAI-compatible API) when GROQ_API_KEY is set, otherwise OpenAI.
const groqKey = process.env.GROQ_API_KEY?.trim() || null
const openaiKey = process.env.OPENAI_API_KEY?.trim() || null
const provider = groqKey ? 'groq' : openaiKey ? 'openai' : null

export const config = {
  port: Number(env('PORT', '8000')),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  ai: {
    provider,
    apiKey: groqKey ?? openaiKey,
    baseURL: groqKey ? env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1') : undefined,
    /** Extracts pickup / dropoff from the transcript. */
    llmModel: groqKey ? env('GROQ_MODEL', 'openai/gpt-oss-120b') : env('OPENAI_MODEL', 'gpt-5.4-mini'),
    /** Tried when the main model is rate-limited (Groq limits are per model). "none" disables. */
    llmFallbackModel: groqKey ? optional(env('GROQ_FALLBACK_MODEL', 'openai/gpt-oss-20b')) : optional(env('OPENAI_FALLBACK_MODEL', 'none')),
    /** Speech-to-text. */
    sttModel: groqKey ? env('GROQ_STT_MODEL', 'whisper-large-v3') : env('OPENAI_STT_MODEL', 'whisper-1'),
    /** "auto" (default) detects Arabic / English from the audio; "ar" / "en" force one. */
    sttLanguage: env('STT_LANGUAGE', 'auto'),
  },

  /**
   * Spoken ride confirmation (/api/tts).
   *  "edge" (default): Microsoft Edge's neural voices — no key, same male voice in every browser.
   *  "openai": OpenAI tts-1 (needs OPENAI_API_KEY).  "none": the browser speaks on its own.
   */
  tts: {
    provider: (['edge', 'openai', 'none'] as const).find((p) => p === env('TTS_PROVIDER', 'edge')) ?? 'edge',
    voiceAr: env('TTS_VOICE_AR', 'ar-SA-HamedNeural'),
    voiceEn: env('TTS_VOICE_EN', 'en-US-ChristopherNeural'),
    openaiKey,
    openaiModel: env('TTS_MODEL', 'tts-1'),
    openaiVoice: env('TTS_VOICE', 'onyx'),
  },

  nominatimUrl: env('NOMINATIM_URL', 'https://nominatim.openstreetmap.org'),
  photonUrl: env('PHOTON_URL', 'https://photon.komoot.io'),
  osrmUrl: env('OSRM_URL', 'https://router.project-osrm.org'),
  userAgent: env('HTTP_USER_AGENT', 'PetraVoice/1.0 (hackathon demo)'),

  dbPath: env('DB_PATH', 'data/petravoice.db'),
} as const
