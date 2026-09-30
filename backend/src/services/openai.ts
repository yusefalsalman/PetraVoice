import OpenAI from 'openai'
import { config } from '../config.ts'

/**
 * Shared AI client — Groq or OpenAI (both speak the OpenAI API; Groq via its baseURL).
 * null when no key is configured.
 */
export const ai = config.ai.apiKey
  ? new OpenAI({ apiKey: config.ai.apiKey, baseURL: config.ai.baseURL, timeout: 20_000, maxRetries: 1 })
  : null
