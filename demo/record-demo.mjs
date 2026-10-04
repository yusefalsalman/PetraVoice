// Fully automated ~1-minute demo video: Jordanian voiceover (Edge neural TTS) → Playwright drives
// the real app through three rides → FFmpeg cuts and merges → backend/demo_video_final.mp4.
//
//   (backend on :8000 and frontend on :5173 running)
//   cd demo && npm run record
//
// Nothing is typed: each request is played into Chromium's fake microphone, so the app hears it
// through the real pipeline (mic → Whisper → LLM → gate registry → OSRM). Each ride is its own take;
// the dead time while the app waits for silence and the server answers is cut out. If Whisper
// mishears a request, that take falls back to typing it, so the video is always produced.
//
// The three rides cover the demo priorities in CLAUDE.md: mic + live waveform, the auto-filled
// confirmation (gate pin, ride type from speech), and the «قصدك؟» two-choice screen.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const OUT_DIR = join(HERE, 'demo-recordings')
const AUDIO_DIR = join(OUT_DIR, 'audio')
const FRAMES_DIR = join(OUT_DIR, 'frames')
const FINAL = resolve(HERE, '..', 'backend', 'demo_video_final.mp4')
/** Jordanian male neural voice. */
const VOICE = 'ar-JO-TaimNeural'
/** Page layout size (the app is a phone-width column; 720 px tall keeps the confirm screen in view)… */
const VIEWPORT = { width: 1280, height: 720 }
/** …rendered at 1.5× pixel density into a true Full HD video. */
const SCALE = 1.5
const VIDEO = { width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE }

// ---------------------------------------------------------------- Script (colloquial Jordanian)

const INTRO = 'مع بترا فويس، احكي وين بدك تروح، والباقي علينا.'
const OUTRO = 'بوابات ودواوير بدقة، وبنفهم اللهجة الأردنية. بترا فويس، احكي وبس.'

/** Fare the way people say it: 2.45 → «دينارين ونص», 15.6 → «خمسطعش دينار ونص». */
function jordanianFare(amount) {
  const r = Math.round(amount * 2) / 2
  const d = Math.floor(r)
  const half = r > d ? ' ونص' : ''
  const W = { 3: 'تلات', 4: 'أربع', 5: 'خمس', 6: 'ست', 7: 'سبع', 8: 'تمن', 9: 'تسع', 10: 'عشر', 11: 'حدعش', 12: 'اطنعش', 13: 'تلطعش', 14: 'أربعطعش', 15: 'خمسطعش', 16: 'ستطعش', 17: 'سبعطعش', 18: 'تمنطعش', 19: 'تسعطعش', 20: 'عشرين' }
  if (d === 0) return 'نص دينار'
  if (d === 1) return `دينار${half}`
  if (d === 2) return `دينارين${half}`
  if (d <= 10) return `${W[d]} دنانير${half}`
  return `${W[d] ?? d} دينار${half}`
}

const RIDES = [
  {
    id: 'gate',
    rider: 'يعطيك العافية، بدي سيارة من مكة مول بوابة 2 لدوار صويلح.',
    expect: (b) => b.pickup?.name?.includes('بوابة 2') && b.dropoff?.name?.includes('صويلح'),
    typed: { pickup: 'مكة مول بوابة 2', dropoff: 'دوار صويلح' },
    reply: (fare) => `أبشر، من مكة مول بوابة 2 لدوار صويلح، بحدود ${fare}.`,
  },
  {
    id: 'family',
    rider: 'بدنا سيارة عائلية من الدوار السابع للمطار، واحنا خمس أشخاص.',
    expect: (b) => b.rideType === 'xl' && b.dropoff?.name?.includes('مطار'),
    typed: { pickup: 'الدوار السابع', dropoff: 'مطار الملكة علياء سيارة عائلية' },
    reply: (fare) => `على راسي، سيارة عائلية للمطار، بحدود ${fare}.`,
  },
  {
    id: 'ambiguous',
    rider: 'وصلني على الجامعة لو سمحت.',
    expect: (b) => b.needsDisambiguation === true && b.options?.length === 5,
    typed: { pickup: '', dropoff: 'الجامعة' },
    ask: 'أي جامعة حاب تروح عليها؟ اختار من الخيارات.',
    choose: 'الجامعة الأردنية',
    reply: (fare) => `تمام، ع البوابة الشمالية للأردنية، بحدود ${fare}.`,
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

let ttsCount = 0
/** Speaks `text` with the Jordanian voice into an mp3; returns { file, seconds }. */
async function voice(text, name = `line_${++ttsCount}`) {
  const file = join(AUDIO_DIR, `${name}.mp3`)
  const tts = new MsEdgeTTS()
  try {
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text, { rate: '+4%' })
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
const cues = [] // { file, ts } voice tracks, wall-clock

/**
 * One browser session per take (the fake microphone plays its file once). Frames are
 * back-to-back screenshots re-rendered at 1.5× — Playwright's recordVideo and the CDP screencast
 * both capture at 1280×720 in headless Chromium whatever the device scale.
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
  const cdp = await context.newCDPSession(page)
  const shot = { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, ...VIEWPORT, scale: SCALE } }
  const screenshot = () =>
    Promise.race([cdp.send('Page.captureScreenshot', shot), sleep(3000).then(() => { throw new Error('screenshot timeout') })])

  await page.goto(APP_URL)
  await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 4, null, { timeout: 15_000 })

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
    await run(page)
  } finally {
    capturing = false
    await capture
    await context.close()
    await browser.close()
  }
}

/** Taps the mic, lets the fake microphone speak, returns the parse response and timings. */
async function speak(page, rider) {
  const parsed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
  await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).click({ force: true })
  const mic = now()
  cues.push({ file: rider.file, ts: mic + 0.45 })
  const body = await (await parsed).json()
  return { mic, body }
}

async function typeInstead(page, typed) {
  await page.getByRole('button', { name: 'إلغاء والبدء من جديد' }).click({ force: true }).catch(() => {})
  await page.getByRole('textbox', { name: 'من أين؟' }).fill(typed.pickup)
  await page.getByRole('textbox', { name: 'إلى أين؟' }).fill(typed.dropoff)
  const retry = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
  await page.getByRole('button', { name: 'ابحث عن رحلة' }).click({ force: true })
  return (await retry).json()
}

async function routeOnScreen(page) {
  await page.getByRole('button', { name: 'تأكيد الرحلة' }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length >= 2, null, { timeout: 15_000 })
  await sleep(700) // map finishes flying to the route
  return now()
}

/** Says `line` over the screen from now, waits for it to finish. */
async function narrate(line, after = 0.4) {
  cues.push({ file: line.file, ts: now() + 0.1 })
  await sleep((line.seconds + after) * 1000)
}

// ---------------------------------------------------------------- The three rides

async function recordRide(ride, i, intro, outro) {
  const rider = await voice(ride.rider, `${ride.id}_rider`)
  const micWav = micInput(rider.file, ride.id)
  ride.rider = Object.assign(rider, { text: ride.rider })

  await take(micWav, async (page) => {
    const start = now()
    if (i === 0) await narrate(intro, 0.2)
    else await sleep(700)

    let { mic, body } = await speak(page, ride.rider)
    log(`  heard «${body.transcript}» → ${body.pickup?.name ?? '—'} ⟶ ${body.dropoff?.name ?? (body.needsDisambiguation ? 'قصدك؟' : '—')} (${body.rideType})`)
    // Keep the listening bar while the rider talks (+1 s), skip the silence wait and the server call.
    keep.push([start, mic + 0.45 + ride.rider.seconds + 0.8])

    let typed = false
    if (!ride.expect(body)) {
      log('  ⚠ not what was asked — typing it instead for this take')
      typed = true
      body = await typeInstead(page, ride.typed)
    }

    if (ride.ask) {
      await page.getByRole('heading', { name: 'أي جامعة؟' }).waitFor({ state: 'visible', timeout: 30_000 })
      const shown = now()
      keep.push([shown - (typed ? 0 : 0.6), Infinity]) // closed below
      await narrate(await voice(ride.ask, `${ride.id}_ask`), 0.1)
      const refreshed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
      await page.locator('button', { hasText: ride.choose }).first().click({ force: true })
      keep.at(-1)[1] = now() + 0.7 // the tap on the choice — then skip the wait for the server
      body = await (await refreshed).json()
      log(`  chose «${ride.choose}» → ${body.dropoff?.name}`)
      keep.push([(await routeOnScreen(page)) - 0.3, Infinity])
    } else {
      const result = await routeOnScreen(page)
      keep.push([result - 1.0, Infinity]) // a moment of «جاري فهم طلبك…», then the result
    }

    const fare = body.fareEstimate?.min
    log(`  fare ${body.fareEstimate?.min}–${body.fareEstimate?.max} JOD → «${jordanianFare(fare)}»`)
    await narrate(await voice(ride.reply(jordanianFare(fare)), `${ride.id}_reply`), 0.3)

    if (ride.last) {
      // Closing shot: pull the sheet down so the whole route fills the screen.
      await page.getByRole('button', { name: 'إخفاء التفاصيل لعرض الخريطة كاملة' }).click({ force: true })
      await sleep(600)
      await narrate(outro, 0.8)
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
  const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(videoTime(c.ts) * 1000)}:all=1[a${i}]`)
  const filter = `${delays.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:duration=longest[aout]`

  ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', list,
    ...inputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-t', total.toFixed(2),
    // Constant 60 fps from the screenshot frames (≈9–14 real frames per second; the rest repeat).
    '-vf', `scale=${VIDEO.width}:${VIDEO.height}:flags=lanczos,fps=60`,
    '-c:v', 'libx264', '-preset', 'slow', '-b:v', '6000k', '-maxrate', '8000k', '-bufsize', '12000k', '-pix_fmt', 'yuv420p', '-r', '60',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    FINAL,
  ])
  writeFileSync(join(OUT_DIR, 'timeline.json'), JSON.stringify({ keep, cues: cues.map((c) => ({ ...c, at: videoTime(c.ts) })) }, null, 2))
}

// ---------------------------------------------------------------- run

setTimeout(() => {
  console.error('Timed out after 6 minutes — see the last step logged above.')
  process.exit(1)
}, 360_000).unref()

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health?.ok) {
  console.error(`App not reachable at ${APP_URL} — start the backend and frontend first.`)
  process.exit(2)
}
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(AUDIO_DIR, { recursive: true })
mkdirSync(FRAMES_DIR, { recursive: true })

log('voiceover: intro + outro…')
const intro = await voice(INTRO, 'intro')
const outro = await voice(OUTRO, 'outro')
for (const [i, ride] of RIDES.entries()) {
  log(`take ${i + 1}/${RIDES.length}: «${ride.rider}»`)
  await recordRide(ride, i, intro, outro)
}
log(`merging ${frames.length} frames and ${cues.length} voice tracks…`)
merge()
log(`done → ${FINAL}  (${(statSync(FINAL).size / 1e6).toFixed(1)} MB, ${duration(FINAL).toFixed(1)} s)`)
