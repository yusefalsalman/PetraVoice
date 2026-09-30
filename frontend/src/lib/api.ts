import axios from 'axios'
import type {
  ApiError,
  ConfirmRideRequest,
  ConfirmRideResponse,
  ParseRideInput,
  ParseRideResponse,
} from '../types/api'
import { mockAmbiguous, mockConfirm, mockError, mockParseText, mockSuccess } from './mockData'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api',
  timeout: 30_000,
  // Read error bodies ourselves — the backend sends { success: false, error } with non-2xx codes.
  validateStatus: () => true,
})

const serverError: ApiError = {
  success: false,
  error: { code: 'SERVER_ERROR', message: 'حدث خطأ في الخادم، حاول مرة أخرى' },
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** `?mock=ambiguous` or `?mock=error` in the URL forces that case in mock mode. */
function mockCase(): string | null {
  return new URLSearchParams(window.location.search).get('mock')
}

function isApiShape(data: unknown): data is { success: boolean } {
  return typeof data === 'object' && data !== null && 'success' in data
}

export async function parseRide(input: ParseRideInput): Promise<ParseRideResponse> {
  if (USE_MOCK) {
    await delay(1200)
    const which = mockCase()
    if (which === 'error') return mockError
    if (which === 'ambiguous') return mockAmbiguous
    // Typed text is really parsed against a small Amman landmark list; audio has no STT in mock mode.
    return input.text ? mockParseText(input.text) : mockSuccess
  }

  const form = new FormData()
  if (input.text) form.append('text', input.text)
  else if (input.audio) form.append('audio', input.audio, 'recording.webm')

  try {
    const { data } = await http.post('/parse-ride', form)
    return isApiShape(data) ? (data as ParseRideResponse) : serverError
  } catch {
    return serverError
  }
}

export async function confirmRide(body: ConfirmRideRequest): Promise<ConfirmRideResponse> {
  if (USE_MOCK) {
    await delay(1200)
    return mockConfirm
  }

  try {
    const { data } = await http.post('/confirm-ride', body)
    return isApiShape(data) ? (data as ConfirmRideResponse) : serverError
  } catch {
    return serverError
  }
}
