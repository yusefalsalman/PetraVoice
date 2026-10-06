import type { ApiErrorCode } from './contract.ts'

// User-facing messages are Arabic; codes are English (contract rule).
const MESSAGES: Record<ApiErrorCode, string> = {
  STT_FAILED: 'تعذر فهم الصوت، حاول مرة أخرى',
  NO_LOCATION_FOUND: 'لم أتعرف على المكان. أعد التسجيل من فضلك، أو جرّب اسم معلم معروف قريب منه.',
  INVALID_AUDIO: 'الملف الصوتي غير صالح، حاول التسجيل مرة أخرى',
  SERVER_ERROR: 'حدث خطأ في الخادم، حاول مرة أخرى',
}

const STATUS: Record<ApiErrorCode, number> = {
  STT_FAILED: 422,
  NO_LOCATION_FOUND: 422,
  INVALID_AUDIO: 400,
  SERVER_ERROR: 500,
}

/** An error the client should see as `{ success: false, error: { code, message } }`. */
export class ApiError extends Error {
  code: ApiErrorCode
  status: number
  userMessage: string

  constructor(code: ApiErrorCode, userMessage?: string, status?: number) {
    super(code)
    this.code = code
    this.userMessage = userMessage ?? MESSAGES[code]
    this.status = status ?? STATUS[code]
  }
}

export const errorBody = (code: ApiErrorCode, message?: string) => ({
  success: false as const,
  error: { code, message: message ?? MESSAGES[code] },
})
