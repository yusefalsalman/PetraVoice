import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import { config } from './config.ts'
import { ApiError, errorBody } from './errors.ts'
import { confirmRideRouter } from './routes/confirmRide.ts'
import { parseRideRouter } from './routes/parseRide.ts'
import { ai } from './services/openai.ts'

const app = express()
app.disable('x-powered-by')

app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST'] }))
app.use(express.json({ limit: '50kb' }))

// One line per request: method, path, status, duration.
app.use((req, res, next) => {
  const started = performance.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Math.round(performance.now() - started)}ms)`)
  })
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: config.ai.provider ?? 'none',
    stt: Boolean(config.ai.apiKey),
    sttModel: config.ai.apiKey ? config.ai.sttModel : null,
    llm: config.ai.apiKey ? config.ai.llmModel : 'rules',
  })
})

app.use('/api', parseRideRouter, confirmRideRouter)

app.use('/api', (_req, res) => {
  res.status(404).json(errorBody('SERVER_ERROR', 'المسار غير موجود'))
})

// Every failure leaves as { success: false, error: { code, message } } (contract).
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json(errorBody(err.code, err.userMessage))
    return
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json(errorBody('INVALID_AUDIO'))
    return
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(400).json(errorBody('SERVER_ERROR', 'الطلب غير صالح'))
    return
  }
  console.error('[server] unhandled error:', err)
  res.status(500).json(errorBody('SERVER_ERROR'))
}
app.use(errorHandler)

app.listen(config.port, () => {
  console.log(`PetraVoice API on http://localhost:${config.port}`)
  console.log(`  CORS: ${config.corsOrigins.join(', ')}`)
  console.log(
    config.ai.apiKey
      ? `  AI: ${config.ai.provider} — STT ${config.ai.sttModel}, LLM ${config.ai.llmModel}`
      : '  AI: no GROQ_API_KEY / OPENAI_API_KEY — text uses the rule-based parser; audio will return STT_FAILED',
  )
  void checkModels()
})

/** Warns at startup if a configured model isn't available to this key (e.g. retired models). */
async function checkModels() {
  if (!ai) return
  try {
    const available = new Set<string>()
    for await (const m of ai.models.list()) available.add(m.id)
    const models: [string, string | null][] = [
      ['LLM', config.ai.llmModel],
      ['LLM fallback', config.ai.llmFallbackModel],
      ['STT', config.ai.sttModel],
    ]
    for (const [role, id] of models) {
      if (id && !available.has(id)) {
        console.warn(`  ⚠ ${role} model "${id}" is not available to this key — ${role === 'STT' ? 'audio will fail' : 'text falls back to rules'}.`)
      }
    }
  } catch (e) {
    console.warn('  ⚠ could not list models:', (e as Error).message)
  }
}
