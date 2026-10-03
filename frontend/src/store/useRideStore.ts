import { create } from 'zustand'
import { confirmRide, parseRide } from '../lib/api'
import { useLang } from '../lib/i18n'
import { CURRENT_LOCATION, isCurrentLocation } from '../lib/location'
import { MicError, startRecording, watchSilence, type Recording } from '../lib/recorder'
import { stopSpeaking } from '../lib/speech'
import type {
  ConfirmRideSuccess,
  DisambiguationOption,
  FareEstimate,
  ParseRideInput,
  ParseRideSuccess,
  Place,
  RideType,
  Route,
} from '../types/api'

export type RideStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'disambiguating'
  | 'confirming'
  | 'dispatched'
  | 'error'

export type Field = 'pickup' | 'dropoff'

export interface UiError {
  code: string
  message: string
}

const MAX_RECORDING_MS = 15_000
/** Auto-stop after this much continuous silence. */
const SILENCE_MS = 3_000

interface RideState {
  status: RideStatus
  transcript: string
  pickup: Place | null
  dropoff: Place | null
  rideType: RideType
  /** The ride type the fare estimate was computed for. */
  parsedRideType: RideType
  /** The rider picked a card by hand — keep it when edited locations are re-resolved. */
  rideTypeManual: boolean
  fareEstimate: FareEstimate | null
  route: Route | null
  options: DisambiguationOption[]
  error: UiError | null
  analyser: AnalyserNode | null
  booking: ConfirmRideSuccess | null
  submitting: boolean
  /** Re-resolving edited locations while staying on the confirm screen. */
  resolving: boolean
  /** What the user last typed, so the inputs survive a failed lookup. */
  typed: { pickup: string; dropoff: string }
  /**
   * Bumped each time a complete ride (both ends + fare) arrives — the confirm screen speaks it.
   * Not part of `initial`, so resets never make an old value look new.
   */
  announce: number

  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  /** Resolve typed pickup/destination names through /api/parse-ride. */
  resolveNames: (pickupName: string, dropoffName: string) => Promise<void>
  chooseOption: (option: DisambiguationOption) => Promise<void>
  setRideType: (rideType: RideType) => void
  confirm: () => Promise<void>
  reset: () => void
}

const initial = {
  status: 'idle' as RideStatus,
  transcript: '',
  pickup: null,
  dropoff: null,
  rideType: 'economy' as RideType,
  parsedRideType: 'economy' as RideType,
  rideTypeManual: false,
  fareEstimate: null,
  route: null,
  options: [],
  error: null,
  analyser: null,
  booking: null,
  submitting: false,
  resolving: false,
  typed: { pickup: '', dropoff: '' },
}

/** Builds the text sent to parse-ride from the two inputs. */
function composeText(pickupName: string, dropoffName: string): string {
  // "Current location" is our own default, not a place the backend can resolve — leave it out.
  const p = isCurrentLocation(pickupName.trim()) ? '' : pickupName.trim()
  const d = dropoffName.trim()
  // Phrase it in the UI language: the backend answers with place names in the request's language.
  if (useLang.getState().lang === 'en') {
    if (p && d) return `from ${p} to ${d}`
    return p ? `from ${p}` : `to ${d}`
  }
  if (p && d) return `من ${p} إلى ${d}`
  return p ? `من ${p}` : `إلى ${d}`
}

let recording: Recording | null = null
let autoStop: ReturnType<typeof setTimeout> | undefined
let stopSilenceWatch: (() => void) | undefined
let requestId = 0

export const useRideStore = create<RideState>()((set, get) => {
  /**
   * @param keepManualRideType re-resolving edited locations: the request text has no ride words,
   *   so a card the rider picked by hand wins over the response's default.
   */
  function apply(res: ParseRideSuccess, keepManualRideType = false) {
    // No pickup named (and none to choose between) → the rider's current location.
    const pickupAsked = res.options.some((o) => o.field === 'pickup')
    const pickup = res.pickup ?? (pickupAsked ? null : { ...CURRENT_LOCATION, confidence: 1 })
    const asking = res.needsDisambiguation && res.options.length > 0
    const complete = !asking && pickup !== null && res.dropoff !== null && res.fareEstimate !== null
    set({
      announce: complete ? get().announce + 1 : get().announce,
      transcript: res.transcript,
      pickup,
      dropoff: res.dropoff,
      // A spoken ride type («سيارة عائلية») pre-selects its card; the rider can still change it.
      rideType: keepManualRideType && get().rideTypeManual ? get().rideType : res.rideType,
      parsedRideType: res.rideType,
      fareEstimate: res.fareEstimate,
      route: res.route ?? null,
      options: res.options,
      error: null,
      resolving: false,
      status: asking ? 'disambiguating' : 'confirming',
    })
  }

  /** Full parse from the home screen: shows the processing screen. */
  async function submit(input: ParseRideInput) {
    const id = ++requestId
    set({ ...initial, typed: get().typed, status: 'processing' })
    const res = await parseRide(input)
    if (id !== requestId) return // superseded or reset meanwhile
    if (res.success) apply(res)
    else set({ status: 'error', error: res.error })
  }

  /** Re-parse while on the confirm screen: keeps current values until the answer arrives. */
  async function refresh(text: string) {
    const id = ++requestId
    set({ resolving: true, error: null })
    const res = await parseRide({ text })
    if (id !== requestId) return
    if (res.success) apply(res, true)
    else set({ resolving: false, error: res.error })
  }

  return {
    ...initial,
    announce: 0,

    startRecording: async () => {
      if (get().status === 'recording') return
      stopSpeaking() // the mic must not hear the app talking
      requestId++ // drop any in-flight parse
      set({ ...initial, status: 'recording' })
      try {
        recording = await startRecording()
      } catch (e) {
        const code = e instanceof MicError ? e.code : 'MIC_UNAVAILABLE'
        // The UI shows this in the current language by code (see errorText in lib/i18n).
        set({ status: 'error', error: { code, message: code } })
        return
      }
      if (get().status !== 'recording') {
        recording.cancel() // user cancelled while the permission prompt was open
        recording = null
        return
      }
      set({ analyser: recording.analyser })
      autoStop = setTimeout(() => void get().stopRecording(), MAX_RECORDING_MS)
      stopSilenceWatch = watchSilence(recording.analyser, SILENCE_MS, (heardSpeech) => {
        if (heardSpeech) {
          void get().stopRecording() // finished talking → send
          return
        }
        // Nothing but silence — don't send an empty clip to the backend.
        get().reset()
        set({ status: 'error', error: { code: 'NO_SPEECH', message: 'لم أسمع صوتاً. اضغط على الميكروفون وتحدّث بوضوح.' } })
      })
    },

    stopRecording: async () => {
      clearTimeout(autoStop)
      stopSilenceWatch?.()
      const current = recording
      recording = null
      if (!current) {
        // Tapped again while the permission prompt was still open — treat as cancel.
        if (get().status === 'recording') set({ ...initial })
        return
      }
      set({ analyser: null })
      const audio = await current.stop()
      if (audio.size === 0) {
        set({
          status: 'error',
          error: { code: 'INVALID_AUDIO', message: 'لم يتم تسجيل أي صوت، حاول مرة أخرى' },
        })
        return
      }
      await submit({ audio })
    },

    resolveNames: async (pickupName, dropoffName) => {
      if (!pickupName.trim() && !dropoffName.trim()) return
      set({ typed: { pickup: pickupName, dropoff: dropoffName } })
      const text = composeText(pickupName, dropoffName)
      if (get().status === 'confirming') await refresh(text)
      else await submit({ text })
    },

    chooseOption: async (option) => {
      const place: Place = { name: option.name, lat: option.lat, lng: option.lng, confidence: 1 }
      set({ [option.field]: place, options: [], status: 'confirming' })
      // Both ends known now — ask the backend again so the route and fare are filled in.
      const { pickup, dropoff } = get()
      if (pickup && dropoff) await refresh(composeText(pickup.name, dropoff.name))
    },

    setRideType: (rideType) => set({ rideType, rideTypeManual: true }),

    confirm: async () => {
      const { pickup, dropoff, rideType, submitting, resolving } = get()
      if (!pickup || !dropoff || submitting || resolving) return
      stopSpeaking()
      set({ submitting: true, error: null })
      const res = await confirmRide({
        pickup: { name: pickup.name, lat: pickup.lat, lng: pickup.lng },
        dropoff: { name: dropoff.name, lat: dropoff.lat, lng: dropoff.lng },
        rideType,
      })
      if (res.success) set({ submitting: false, booking: res, status: 'dispatched' })
      else set({ submitting: false, error: res.error })
    },

    reset: () => {
      requestId++
      stopSpeaking()
      clearTimeout(autoStop)
      stopSilenceWatch?.()
      recording?.cancel()
      recording = null
      set({ ...initial })
    },
  }
})
