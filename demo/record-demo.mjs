// Clean screen recording of the working MVP → backend/demo_video_final.mp4 (1920×1080, 60 fps).
//
//   (backend on :8000 and frontend on :5173 running)
//   cd demo && npm run record
//
// No narration, captions or title cards: the video opens on the app and contains only what the app
// does. The only sounds are the rider's spoken request (played into Chromium's fake microphone, so it
// goes through the real pipeline: mic → Whisper → LLM → gate registry → OSRM) and the app's own
// spoken replies, captured from its /api/tts responses and placed when the app played them.
// The dead time while the app waits for silence and the server answers is cut. If Whisper mishears
// a request, that take falls back to typing it, so a video is always produced.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const OUT_DIR = join(HERE, 'demo-recordings', 'landscape')
const AUDIO_DIR = join(OUT_DIR, 'audio')
const FRAMES_DIR = join(OUT_DIR, 'frames')
const FINAL = resolve(HERE, '..', 'backend', 'demo_video_final.mp4')
/** The rider's voice (Jordanian male) — the spoken request fed to the microphone. */
const RIDER_VOICE = 'ar-JO-TaimNeural'
/** Page layout size (the app is a phone-width column; 720 px tall keeps the confirm screen in view)… */
const VIEWPORT = { width: 1280, height: 720 }
/** …rendered at 1.5× pixel density into a true Full HD video. */
const SCALE = 1.5
const VIDEO = { width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE }

const RIDES = [
  {
    id: 'gate',
    rider: 'يعطيك العافية، بدي سيارة من مكة مول بوابة 2 لدوار صويلح.',
    expect: (b) => b.pickup?.name?.includes('بوابة 2') && b.dropoff?.name?.includes('صويلح'),
    typed: { pickup: 'مكة مول بوابة 2', dropoff: 'دوار صويلح' },
    tiers: ['مريح', 'XL عائلي', 'اقتصادي'], // tap through the ride tiers: prices update
  },
  {
    id: 'family',
    rider: 'بدنا سيارة عائلية من الدوار السابع للمطار، واحنا خمس أشخاص.',
    expect: (b) => b.rideType === 'xl' && b.dropoff?.name?.includes('مطار'),
    typed: { pickup: 'الدوار السابع', dropoff: 'مطار الملكة علياء سيارة عائلية' },
  },
  {
    id: 'ambiguous',
    rider: 'وصلني على الجامعة لو سمحت.',
    expect: (b) => b.needsDisambiguation === true,
    typed: { pickup: '', dropoff: 'الجامعة' },
    choose: 'الجامعة الأردنية',
    last: true,
  },
]

// ---------------------------------------------------------------- Helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
const now = () => Date.now() / 1000
const ffmpeg = (args) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

/** Media duration in seconds (ffmpeg prints it on stderr). */
function duration(file) {
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    const m = String(e.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/)
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  throw new Error(`could not read the duration of ${file}`)
}

/** The rider's spoken request as an mp3. */
async function riderVoice(text, name) {
  const file = join(AUDIO_DIR, `${name}_rider.mp3`)
  const tts = new MsEdgeTTS()
  try {
    await tts.setMetadata(RIDER_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text)
    const chunks = []
    for await (const c of audioStream) chunks.push(c)
    writeFileSync(file, Buffer.concat(chunks))
  } finally {
    tts.close()
  }
  return { file, seconds: duration(file) }
}

/** The fake microphone needs WAV: a short lead-in, the request, then silence so the app sends it. */
function micInput(mp3, name) {
  const wav = join(AUDIO_DIR, `${name}_mic.wav`)
  ffmpeg(['-i', mp3, '-af', 'adelay=400:all=1,apad=pad_dur=4', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  return wav
}

// ---------------------------------------------------------------- Recording one take

const frames = [] // { ts, file } across all takes
const keep = [] // [from, to] wall-clock ranges that make it into the video, in order
const cues = [] // { file, ts, seconds } audio, wall-clock

/**
 * One browser session per take (the fake microphone plays its file once). Frames are back-to-back
 * screenshots re-rendered at 1.5× (Playwright's recordVideo and the CDP screencast both capture at
 * CSS-pixel size in headless Chromium). The app's spoken replies are saved as they arrive.
 */
async function take(micWav, run) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${micWav}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, permissions: ['microphone'], locale: 'ar-JO' })
  const page = await context.newPage()

  // The app's voice: every /api/tts answer is the audio the app plays right then.
  const spoken = []
  let waiter = null
  // (Chromium doesn't keep audio response bodies for Playwright, so the request is passed through
  // here: the app gets exactly the bytes we save.)
  await page.route('**/api/tts', async (route) => {
    const res = await route.fetch()
    const body = await res.body()
    await route.fulfill({ response: res, body })
    if (!res.ok() || body.length < 2000) return
    const file = join(AUDIO_DIR, `app_${cues.length}_${Date.now()}.mp3`)
    writeFileSync(file, body)
    let line
    try {
      line = { file, ts: now(), seconds: duration(file) } // playback starts as the reply arrives
    } catch {
      return
    }
    cues.push(line)
    spoken.push(line)
    waiter?.(line)
  })
  /** Waits for the app to speak (or returns the line it already spoke since `since`). */
  const appSpeech = (since, timeout = 12_000) => {
    const done = spoken.find((l) => l.ts >= since)
    if (done) return Promise.resolve(done)
    return Promise.race([new Promise((r) => (waiter = r)), sleep(timeout).then(() => null)])
  }

  const cdp = await context.newCDPSession(page)
  const shot = { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, ...VIEWPORT, scale: SCALE } }
  const screenshot = () =>
    Promise.race([cdp.send('Page.captureScreenshot', shot), sleep(3000).then(() => { throw new Error('screenshot timeout') })])

  await page.goto(APP_URL)
  await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 4, null, { timeout: 15_000 })
  await sleep(400)

  let capturing = true
  const capture = (async () => {
    while (capturing) {
      const before = Date.now()
      try {
        const { data } = await screenshot()
        const file = join(FRAMES_DIR, `${String(frames.length).padStart(5, '0')}.jpg`)
        writeFileSync(file, Buffer.from(data, 'base64'))
        frames.push({ ts: (before + Date.now()) / 2000, file })
      } catch {
        await sleep(50)
      }
    }
  })()
  await sleep(300) // first frame in

  try {
    await run(page, appSpeech)
  } finally {
    capturing = false
    await capture
    await context.close()
    await browser.close()
  }
}

async function typeInstead(page, typed) {
  await page.getByRole('button', { name: 'إلغاء والبدء من جديد' }).click({ force: true }).catch(() => {})
  if (typed.pickup) await page.getByRole('textbox', { name: 'من أين؟' }).fill(typed.pickup)
  await page.getByRole('textbox', { name: 'إلى أين؟' }).fill(typed.dropoff)
  const retry = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
  await page.getByRole('button', { name: 'ابحث عن رحلة' }).click({ force: true })
  return (await retry).json()
}

/** Waits for the confirm screen with the route drawn; returns when it first appeared. */
async function routeOnScreen(page) {
  await page.getByRole('button', { name: 'تأكيد الرحلة' }).waitFor({ state: 'visible', timeout: 30_000 })
  const shown = now()
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length >= 2, null, { timeout: 15_000 })
  return shown
}

/** Lets the app finish speaking `line` (null = it didn't speak). */
const listen = (line, after = 0.4) => sleep(line ? Math.max(0, line.ts + line.seconds + after - now()) * 1000 : 1500)

// ---------------------------------------------------------------- The three rides

async function recordRide(ride) {
  const rider = await riderVoice(ride.rider, ride.id)
  const micWav = micInput(rider.file, ride.id)

  await take(micWav, async (page, appSpeech) => {
    const start = now()
    await sleep(900) // the home screen, then the tap

    // 1. The rider taps the mic and speaks — the waveform reacts live.
    const parsed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
    const tap = now()
    await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).click({ force: true })
    cues.push({ file: rider.file, ts: tap + 0.45, seconds: rider.seconds })
    let body = await (await parsed).json()
    log(`  heard «${body.transcript}» → ${body.pickup?.name ?? '—'} ⟶ ${body.dropoff?.name ?? (body.needsDisambiguation ? `${body.options.length} options` : '—')} (${body.rideType})`)
    // Keep the listening bar while the rider talks; cut the silence wait and the server call.
    keep.push([start, tap + 0.45 + rider.seconds + 0.8])

    if (!ride.expect(body)) {
      log('  ⚠ not what was asked — typing it instead for this take')
      body = await typeInstead(page, ride.typed)
    }

    // 2. A vague place: the app asks out loud and shows the choices; the rider taps one.
    if (ride.choose) {
      const heading = page.getByRole('heading', { name: /^أي |قصدك/ })
      await heading.waitFor({ state: 'visible', timeout: 30_000 })
      const shown = now() - 0.3
      keep.push([shown, Infinity])
      await listen(await appSpeech(shown), 0.6)
      const refreshed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
      await page.locator('ul button', { hasText: ride.choose }).first().click({ force: true })
      keep.at(-1)[1] = now() + 0.5 // the tap — then skip the wait for the server
      body = await (await refreshed).json()
      log(`  chose «${ride.choose}» → ${body.dropoff?.name}`)
    }

    // 3. The route, the tiers and the price appear; the app reads the ride back.
    const shown = await routeOnScreen(page)
    keep.push([shown - 0.5, Infinity])
    log(`  fare ${body.fareEstimate?.min}–${body.fareEstimate?.max} JOD (${body.rideType})`)
    await listen(await appSpeech(shown), 0.5)

    // 4. Tap through the ride tiers: the price changes with each.
    for (const tier of ride.tiers ?? []) {
      await page.locator('fieldset button', { hasText: tier }).click({ force: true })
      await sleep(1100)
    }

    if (ride.last) {
      // Pull the sheet down to show the whole route on the map.
      await page.getByRole('button', { name: 'إخفاء التفاصيل لعرض الخريطة كاملة' }).click({ force: true })
      await sleep(2500)
    }
    keep.at(-1)[1] = now()
  })
}

// ---------------------------------------------------------------- Merge

/** Wall-clock → video time, through the kept ranges. */
function videoTime(ts) {
  let t = 0
  for (const [a, b] of keep) {
    if (ts < a) return t
    if (ts <= b) return t + (ts - a)
    t += b - a
  }
  return t
}

function merge() {
  const sorted = [...frames].sort((a, b) => a.ts - b.ts)
  const lines = []
  let last
  for (const [a, b] of keep) {
    const first = Math.max(0, sorted.findLastIndex((f) => f.ts <= a))
    const used = sorted.slice(first).filter((f, k) => k === 0 || f.ts < b)
    used.forEach((f, k) => {
      const from = Math.max(f.ts, a)
      const to = k + 1 < used.length ? used[k + 1].ts : b
      if (to - from <= 0) return
      lines.push(`file '${f.file.replaceAll('\\', '/')}'`, `duration ${(to - from).toFixed(4)}`)
      last = f
    })
  }
  lines.push(`file '${last.file.replaceAll('\\', '/')}'`) // concat demuxer: repeat the last frame
  const list = join(OUT_DIR, 'frames.txt')
  writeFileSync(list, lines.join('\n'))

  const total = keep.reduce((s, [a, b]) => s + (b - a), 0)
  const inputs = cues.flatMap((c) => ['-i', c.file])
  const tracks = cues.map(
    (c, i) =>
      `[${i + 1}:a]afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, c.seconds - 0.08).toFixed(2)}:d=0.08,adelay=${Math.round(videoTime(c.ts) * 1000)}:all=1[a${i}]`,
  )
  const filter = `${tracks.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:duration=longest[aout]`

  ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list,
    ...inputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-t', total.toFixed(2),
    // Constant 60 fps from the screenshot frames (≈10 real frames per second; the rest repeat).
    '-vf', `scale=${VIDEO.width}:${VIDEO.height}:flags=lanczos,fps=60`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    FINAL,
  ])
  writeFileSync(join(OUT_DIR, 'timeline.json'), JSON.stringify({ total, keep, cues: cues.map((c) => ({ ...c, at: videoTime(c.ts) })) }, null, 2))
}

// ---------------------------------------------------------------- run

setTimeout(() => {
  console.error('Timed out after 8 minutes — see the last step logged above.')
  process.exit(1)
}, 480_000).unref()

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health?.ok) {
  console.error(`App not reachable at ${APP_URL} — start the backend and frontend first.`)
  process.exit(2)
}
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(AUDIO_DIR, { recursive: true })
mkdirSync(FRAMES_DIR, { recursive: true })

for (const [i, ride] of RIDES.entries()) {
  log(`take ${i + 1}/${RIDES.length}: «${ride.rider}»`)
  await recordRide(ride)
}
const appLines = cues.filter((c) => c.file.includes('app_')).length
log(`merging ${frames.length} frames, ${cues.length - appLines} spoken requests and ${appLines} app replies…`)
merge()
log(`done → ${FINAL}  (${(statSync(FINAL).size / 1e6).toFixed(1)} MB, ${duration(FINAL).toFixed(1)} s)`)
