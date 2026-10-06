import axios from 'axios'
import type {
  ApiError,
  ConfirmRideRequest,
  ConfirmRideResponse,
  ParseRideInput,
  ParseRideResponse,
} from '../types/api'
import { locateRider } from './location'

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

function isApiShape(data: unknown): data is { success: boolean } {
  return typeof data === 'object' && data !== null && 'success' in data
}

export async function parseRide(input: ParseRideInput): Promise<ParseRideResponse> {
  const form = new FormData()
  if (input.text) form.append('text', input.text)
  else if (input.audio) form.append('audio', input.audio, 'recording.webm')
  // The phone's position for «من بيتي» / «من موقعي». Usually ready already (asked when the mic
  // was tapped); never hold the request up for long if the rider hasn't answered the prompt.
  const here = await Promise.race([locateRider(), new Promise<null>((r) => setTimeout(() => r(null), 1500))])
  if (here) {
    form.append('lat', String(here.lat))
    form.append('lng', String(here.lng))
  }

  try {
    const { data } = await http.post('/parse-ride', form)
    return isApiShape(data) ? (data as ParseRideResponse) : serverError
  } catch {
    return serverError
  }
}

export async function confirmRide(body: ConfirmRideRequest): Promise<ConfirmRideResponse> {
  try {
    const { data } = await http.post('/confirm-ride', body)
    return isApiShape(data) ? (data as ConfirmRideResponse) : serverError
  } catch {
    return serverError
  }
}
