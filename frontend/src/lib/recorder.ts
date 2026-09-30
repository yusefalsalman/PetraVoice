// Native MediaRecorder + AnalyserNode wrapper. Only works on localhost or HTTPS.

export type MicErrorCode = 'MIC_DENIED' | 'MIC_UNSUPPORTED' | 'MIC_UNAVAILABLE'

/** Mic failure; the UI turns `code` into a message in the current language. */
export class MicError extends Error {
  code: MicErrorCode
  constructor(code: MicErrorCode) {
    super(code)
    this.code = code
  }
}

export interface Recording {
  analyser: AnalyserNode
  stop: () => Promise<Blob>
  cancel: () => void
}

/** RMS level (0–1) above which a frame counts as speech. Quiet rooms sit around 0.002–0.01. */
const SPEECH_RMS = 0.02
const CHECK_EVERY_MS = 100

/**
 * Calls `onSilence(heardSpeech)` once the input stays below the speech threshold for
 * `silenceMs` in a row. Returns a function that stops watching.
 */
export function watchSilence(
  analyser: AnalyserNode,
  silenceMs: number,
  onSilence: (heardSpeech: boolean) => void,
): () => void {
  const samples = new Float32Array(analyser.fftSize)
  let heardSpeech = false
  let quietSince = performance.now()

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const v of samples) sum += v * v
    const rms = Math.sqrt(sum / samples.length)
    const now = performance.now()

    if (rms > SPEECH_RMS) {
      heardSpeech = true
      quietSince = now
    } else if (now - quietSince >= silenceMs) {
      clearInterval(timer)
      onSilence(heardSpeech)
    }
  }, CHECK_EVERY_MS)

  return () => clearInterval(timer)
}

function pickMimeType(): string | undefined {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return undefined // browser default (e.g. mp4 on older Safari)
}

export async function startRecording(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new MicError('MIC_UNSUPPORTED')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    const denied = e instanceof DOMException && e.name === 'NotAllowedError'
    throw new MicError(denied ? 'MIC_DENIED' : 'MIC_UNAVAILABLE')
  }

  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.75
  ctx.createMediaStreamSource(stream).connect(analyser)

  // Release the mic so the browser's recording indicator turns off.
  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  recorder.start()

  return {
    analyser,
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
