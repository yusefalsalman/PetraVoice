// Vertical phone demo (9:16, 1080×1920, 60 fps): Jordanian voiceover, three real voice bookings in
// the running app, word-by-word typed captions, crossfade / slide transitions, intro + outro cards.
//
//   (backend on :8000 and frontend on :5173 running)
//   cd demo && npm run record:vertical        → backend/demo_video_vertical_final.mp4
//
// The app is shown full-frame (no zoom). Capture: back-to-back screenshots of a 432×768 phone viewport
// re-rendered at 2.5× = 1080×1920 (≈10 new frames/s of the app itself; Playwright's recordVideo and the
// CDP screencast stay at CSS-pixel size in headless Chromium). Captions, text typing, transitions and
// cards are rendered by FFmpeg at the full 60 fps. Captions and cards are drawn by Chromium (Tajawal,
// correct Arabic shaping) as transparent PNGs.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { chromium } from 'playwright'
import { PERMANENT_LINK } from './publish-link.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const OUT_DIR = join(HERE, 'demo-recordings', 'vertical')
const AUDIO_DIR = join(OUT_DIR, 'audio')
const FRAMES_DIR = join(OUT_DIR, 'frames')
const CAPTION_DIR = join(OUT_DIR, 'captions')
const FINAL = resolve(HERE, '..', 'backend', 'demo_video_vertical_final.mp4')
const QR_IMAGE = join(HERE, 'petravoice-qr.png')
const VOICE = 'ar-JO-TaimNeural' // Jordanian male neural voice
const VIEWPORT = { width: 432, height: 768 } // 9:16 phone layout…
const SCALE = 2.5 // …rendered at 2.5× → exactly 1080×1920
const W = VIEWPORT.width * SCALE
const H = VIEWPORT.height * SCALE
const FPS = 60
const CAPTION_Y = 215 // output px, just under the app header

// Transitions between clips (FFmpeg xfade).
const CUT = { type: 'fade', d: 0.35 } // inside a ride: skipping the wait for the server
const NEXT_RIDE = { type: 'smoothleft', d: 0.6 } // from one ride to the next
const CARD_IN = { type: 'fade', d: 0.7 }

// ---------------------------------------------------------------- Script (colloquial Jordanian)

const INTRO = 'مع بترا فويس، احكي وين بدك تروح، والباقي علينا.'
const OUTRO = 'بوابات ودواوير بدقة، وبنفهم اللهجة الأردنية. بترا فويس، احكي وبس.'

/** Fare the way people say it: 2.45 → «دينارين ونص», 15.6 → «خمسطعش دينار ونص». */
function jordanianFare(amount) {
  const r = Math.round(amount * 2) / 2
  const d = Math.floor(r)
  const half = r > d ? ' ونص' : ''
  const N = { 3: 'تلات', 4: 'أربع', 5: 'خمس', 6: 'ست', 7: 'سبع', 8: 'تمن', 9: 'تسع', 10: 'عشر', 11: 'حدعش', 12: 'اطنعش', 13: 'تلطعش', 14: 'أربعطعش', 15: 'خمسطعش', 16: 'ستطعش', 17: 'سبعطعش', 18: 'تمنطعش', 19: 'تسعطعش', 20: 'عشرين' }
  if (d === 0) return 'نص دينار'
  if (d === 1) return `دينار${half}`
  if (d === 2) return `دينارين${half}`
  if (d <= 10) return `${N[d]} دنانير${half}`
  return `${N[d] ?? d} دينار${half}`
}

const RIDES = [
  {
    id: 'gate',
    rider: 'يعطيك العافية، بدي سيارة من مكة مول بوابة 2 لدوار صويلح.',
    riderCaption: 'يعطيك العافية، بدي سيارة من مكة مول بوابة 2 لدوار صويلح',
    expect: (b) => b.pickup?.name?.includes('بوابة 2') && b.dropoff?.name?.includes('صويلح'),
    typed: { pickup: 'مكة مول بوابة 2', dropoff: 'دوار صويلح' },
    reply: (fare) => `أبشر، من مكة مول بوابة 2 لدوار صويلح، بحدود ${fare}.`,
    results: [
      { text: 'تحديد البوابة تلقائياً:', accent: 'مكة مول · بوابة 2', at: 0.4, dur: 2.8 },
      { text: 'رسم المسار المباشر', accent: 'لدوار صويلح', at: 3.4, dur: 2.5 },
      { text: 'تأكيد فوري', accent: 'بالصوت والتسعيرة', at: 6.1, dur: 2.5 },
    ],
  },
  {
    id: 'family',
    rider: 'بدنا سيارة عائلية من الدوار السابع للمطار، واحنا خمس أشخاص.',
    riderCaption: 'بدنا سيارة عائلية من الدوار السابع للمطار، واحنا خمس أشخاص',
    expect: (b) => b.rideType === 'xl' && b.dropoff?.name?.includes('مطار'),
    typed: { pickup: 'الدوار السابع', dropoff: 'مطار الملكة علياء سيارة عائلية' },
    reply: (fare) => `على راسي، سيارة عائلية للمطار، بحدود ${fare}.`,
    results: [{ text: 'نوع السيارة من كلامك:', accent: 'عائلي XL', at: 0.4, dur: 3.4 }],
  },
  {
    id: 'ambiguous',
    rider: 'وصلني على الجامعة لو سمحت.',
    riderCaption: 'وصلني على الجامعة لو سمحت',
    expect: (b) => b.needsDisambiguation === true && b.options?.length === 5,
    typed: { pickup: '', dropoff: 'الجامعة' },
    ask: 'أي جامعة حاب تروح عليها؟ اختار من الخيارات.',
    askCaption: { text: 'أي جامعة؟', accent: 'خمس خيارات بلمسة' },
    choose: 'الجامعة الأردنية',
    reply: (fare) => `تمام، ع البوابة الشمالية للأردنية، بحدود ${fare}.`,
    results: [{ text: 'الجامعة الأردنية ·', accent: 'البوابة الشمالية', at: 0.4, dur: 3.0 }],
    last: true,
  },
]

// ---------------------------------------------------------------- Helpers

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
const now = () => Date.now() / 1000
const ffmpeg = (args) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

function duration(file) {
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    const m = String(e.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/)
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  throw new Error(`could not read the duration of ${file}`)
}

async function voice(text, name) {
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

function micInput(mp3, name) {
  const wav = join(AUDIO_DIR, `${name}_mic.wav`)
  ffmpeg(['-i', mp3, '-af', 'adelay=400:all=1,apad=pad_dur=4', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  return wav
}

// ---------------------------------------------------------------- Timeline
// Clips in order: cards ({ kind: 'card', name, len }) and app recordings ({ kind: 'app', from, to }
// in wall-clock seconds). transitions[k] joins clip k and k + 1. Voice lines and captions are placed
// either at a wall-clock time (ts, inside an app clip) or at an output time (at).

const frames = [] // { ts, file }
const clips = []
const transitions = []
const cues = [] // { file, seconds, ts | at }
const captions = [] // { words: [{ w, accent }], kind, dur, rev, y?, ts | at }

function addClip(clip, transition) {
  if (clips.length) transitions.push(transition)
  clips.push(clip)
  return clip
}

/** Caption text → words; the accent part is highlighted. */
const words = (text, accent = '') => [
  ...text.split(/\s+/).filter(Boolean).map((w) => ({ w, accent: false })),
  ...accent.split(/\s+/).filter(Boolean).map((w) => ({ w, accent: true })),
]

/**
 * A caption that types in word by word: `rev` seconds to reveal all words, shown `dur` seconds in total.
 * Spoken-quote captions reveal at the pace of the speech.
 */
function caption(when, dur, text, accent = '', kind = 'info', rev = null, y = CAPTION_Y) {
  const ws = words(text, accent)
  captions.push({ ...when, dur, words: ws, kind, rev: rev ?? Math.min(1.1, 0.13 * ws.length), y })
}

// ---------------------------------------------------------------- One take = one browser session

async function take(micWav, run) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${micWav}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, permissions: ['microphone'], locale: 'ar-JO' })
  const page = await context.newPage()
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
  await sleep(300)

  try {
    await run(page)
  } finally {
    capturing = false
    await capture
    await context.close()
    await browser.close()
  }
}

async function narrate(line, after = 0.3) {
  cues.push({ file: line.file, seconds: line.seconds, ts: now() + 0.1 })
  await sleep((line.seconds + after) * 1000)
}

async function routeOnScreen(page) {
  await page.getByRole('button', { name: 'تأكيد الرحلة' }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length >= 2, null, { timeout: 15_000 })
  await sleep(800) // map finishes flying to the route
  return now()
}

async function typeInstead(page, typed) {
  await page.getByRole('button', { name: 'إلغاء والبدء من جديد' }).click({ force: true }).catch(() => {})
  if (typed.pickup) await page.getByRole('textbox', { name: 'من أين؟' }).fill(typed.pickup)
  await page.getByRole('textbox', { name: 'إلى أين؟' }).fill(typed.dropoff)
  const retry = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
  await page.getByRole('button', { name: 'ابحث عن رحلة' }).click({ force: true })
  return (await retry).json()
}

// ---------------------------------------------------------------- The rides

async function recordRide(ride, i) {
  const rider = await voice(ride.rider, `${ride.id}_rider`)
  const micWav = micInput(rider.file, ride.id)

  await take(micWav, async (page) => {
    const start = now()
    await sleep(800) // the home screen, then the tap

    // The rider speaks: their words type onto the screen at the pace of the speech, on the way to Whisper.
    const parsed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
    const tap = now()
    await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).click({ force: true })
    cues.push({ file: rider.file, seconds: rider.seconds, ts: tap + 0.45 })
    caption({ ts: tap + 0.45 }, rider.seconds + 0.75, `«${ride.riderCaption}»`, '', 'quote', rider.seconds * 0.95)
    const spokenEnd = tap + 0.45 + rider.seconds + 0.8
    let body = await (await parsed).json()
    log(`  heard «${body.transcript}» → ${body.pickup?.name ?? '—'} ⟶ ${body.dropoff?.name ?? (body.needsDisambiguation ? 'أي جامعة؟' : '—')} (${body.rideType})`)
    let clip = addClip({ kind: 'app', from: start, to: spokenEnd }, i === 0 ? CARD_IN : NEXT_RIDE)

    if (!ride.expect(body)) {
      log('  ⚠ not what was asked — typing it instead for this take')
      body = await typeInstead(page, ride.typed)
    }

    if (ride.ask) {
      await page.getByRole('heading', { name: 'أي جامعة؟' }).waitFor({ state: 'visible', timeout: 30_000 })
      const shown = now() - 0.4
      clip = addClip({ kind: 'app', from: shown, to: Infinity }, CUT)
      caption({ ts: shown + 0.5 }, 3.4, ride.askCaption.text, ride.askCaption.accent)
      await narrate(await voice(ride.ask, `${ride.id}_ask`), 0.2)
      const refreshed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
      await page.locator('ul button', { hasText: ride.choose }).first().click({ force: true })
      clip.to = now() + 0.6
      body = await (await refreshed).json()
      log(`  chose «${ride.choose}» → ${body.dropoff?.name}`)
    }

    const result = await routeOnScreen(page)
    clip = addClip({ kind: 'app', from: result - 0.9, to: Infinity }, CUT)
    const fare = body.fareEstimate?.min
    log(`  fare ${body.fareEstimate?.min}–${body.fareEstimate?.max} JOD → «${jordanianFare(fare)}»`)
    for (const c of ride.results) caption({ ts: result + c.at }, c.dur, c.text, c.accent)

    await narrate(await voice(ride.reply(jordanianFare(fare)), `${ride.id}_reply`), 0.3)
    const holdUntil = result + Math.max(5.2, ...ride.results.map((c) => c.at + c.dur + 0.3))
    if (now() < holdUntil) await sleep((holdUntil - now()) * 1000)

    if (ride.last) {
      // Closing shot: pull the sheet down to show the whole route.
      await page.getByRole('button', { name: 'إخفاء التفاصيل لعرض الخريطة كاملة' }).click({ force: true })
      await sleep(2200)
    }
    clip.to = now()
  })
}

// ---------------------------------------------------------------- Cards and captions → PNGs (Chromium)

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@500;700;800&family=Inter:wght@600;800&display=block" rel="stylesheet">`
const CARD_CSS = `
  html, body { margin: 0; width: ${W}px; height: ${H}px; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; text-align: center; color: #fff;
    font-family: Tajawal, sans-serif; background: radial-gradient(900px 700px at 80% 10%, #1d4ed8 0%, transparent 60%),
    radial-gradient(800px 700px at 10% 95%, #047857 0%, transparent 55%), #00174b; }
  .logo { width: 220px; height: 220px; border-radius: 56px; background: #fff; color: #00174b; display: grid; place-items: center;
    font: 800 140px/1 Inter, sans-serif; box-shadow: 0 30px 80px rgb(0 0 0 / .35); }
  .name { font: 800 92px/1.1 Tajawal, sans-serif; margin-top: 30px; }
  .en { font: 800 46px/1.2 Inter, sans-serif; letter-spacing: .02em; opacity: .85; }
  .team { position: absolute; bottom: 120px; left: 0; right: 0; font: 600 30px/1.4 Inter, sans-serif; opacity: .7; }
  .qr { width: 520px; height: 520px; padding: 28px; border-radius: 44px; background: #fff; box-shadow: 0 30px 80px rgb(0 0 0 / .35); }
  .qr img { width: 100%; height: 100%; }
  .link { font: 800 40px/1.2 Inter, sans-serif; color: #6ee7b7; }
  .scan { font: 700 34px/1.4 Tajawal, sans-serif; opacity: .85; }`

/** Measured y (output px) of the title slot on each card. */
const titleSlots = {}

async function renderCards(page) {
  const qr = `data:image/png;base64,${readFileSync(QR_IMAGE).toString('base64')}`
  const cards = {
    intro: `<div class="logo">P</div><div class="name">بترا فويس</div><div class="en">PetraVoice · PetraRide</div>
      <div id="titleSlot" style="height:220px"></div><div class="team">Jordan 2076 Hackathon · Aqaba 2076 Track · Team PromptRiders</div>`,
    outro: `<div class="logo" style="width:150px;height:150px;font-size:96px;border-radius:40px">P</div>
      <div id="titleSlot" style="height:170px"></div>
      <div class="qr"><img src="${qr}"></div><div class="link">${PERMANENT_LINK.replace('https://', '').replace(/\/$/, '')}</div>
      <div class="scan">امسح الرمز وجرّبها بنفسك · Scan to try it live</div>`,
  }
  for (const [name, body] of Object.entries(cards)) {
    await page.setViewportSize({ width: W, height: H })
    await page.setContent(`<!doctype html><html dir="rtl"><head>${FONTS}<style>${CARD_CSS}</style></head><body>${body}</body></html>`)
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(CAPTION_DIR, `card_${name}.png`) })
    // Where the typed title goes on this card: the empty slot under the logo.
    const slot = await page.locator('#titleSlot').boundingBox().catch(() => null)
    if (slot) titleSlots[name] = Math.round(slot.y + slot.height / 2 - 75) // caption PNG ≈ 150 px tall
  }
}

/** One PNG per typing stage: stage k shows the first k words; the rest keep their space (no jumping). */
async function renderCaptions(page) {
  await page.setViewportSize({ width: W, height: 700 })
  await page.setContent(`<!doctype html><html dir="rtl"><head>${FONTS}<style>
    html, body { margin: 0; background: transparent; }
    #wrap { display: inline-block; padding: 26px 30px 34px; }
    .pill { display: inline-flex; align-items: center; gap: 18px; max-width: 980px; padding: 20px 38px 22px; border-radius: 48px;
      font: 800 44px/1.35 Tajawal, sans-serif; box-shadow: 0 14px 34px rgb(0 0 0 / .32), 0 2px 6px rgb(0 0 0 / .18); }
    .info { background: rgb(0 23 75 / .95); color: #fff; border: 2px solid rgb(255 255 255 / .14); white-space: nowrap; }
    .info .accent { color: #6ee7b7; }
    .dot { width: 16px; height: 16px; flex: none; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 7px rgb(52 211 153 / .25); }
    .quote { background: rgb(255 255 255 / .97); color: #00174b; font-weight: 700; border: 3px solid #00174b; max-width: 940px; }
    .quote .txt { text-align: right; }
    .mic { width: 44px; height: 44px; flex: none; border-radius: 50%; background: #00174b; display: grid; place-items: center; }
    .title { color: #fff; font: 800 64px/1.35 Tajawal, sans-serif; max-width: 900px; text-align: center; text-shadow: 0 6px 24px rgb(0 0 0 / .35); }
    .hidden { visibility: hidden; }
  </style></head><body><div id="wrap"></div></body></html>`)
  await page.evaluate(() => document.fonts.ready)
  const mic = '<span class="mic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg></span>'

  for (const [i, c] of captions.entries()) {
    c.stages = []
    for (let k = 1; k <= c.words.length; k++) {
      const text = c.words.map((w, j) => `<span class="${[w.accent ? 'accent' : '', j >= k ? 'hidden' : ''].join(' ')}">${w.w}</span>`).join(' ')
      const html =
        c.kind === 'quote' ? `<div class="pill quote">${mic}<span class="txt">${text}</span></div>`
        : c.kind === 'title' ? `<div class="title">${text}</div>`
        : `<div class="pill info"><span class="dot"></span><span>${text}</span></div>`
      await page.evaluate((h) => (document.getElementById('wrap').innerHTML = h), html)
      const file = join(CAPTION_DIR, `cap_${i}_${k}.png`)
      await page.locator('#wrap').screenshot({ path: file, omitBackground: true })
      c.stages.push(file)
    }
  }
}

// ---------------------------------------------------------------- Edit & export

function exportVideo() {
  // Clip lengths and where each starts in the output (transitions overlap neighbouring clips).
  const len = clips.map((c) => (c.kind === 'card' ? c.len : c.to - c.from))
  const start = [0]
  for (let k = 1; k < clips.length; k++) start[k] = start[k - 1] + len[k - 1] - transitions[k - 1].d
  const total = start.at(-1) + len.at(-1)
  const outTime = (w) => {
    if (w.at !== undefined) return w.at
    const k = clips.findIndex((c) => c.kind === 'app' && w.ts >= c.from - 1e-3 && w.ts <= c.to + 1e-3)
    if (k < 0) throw new Error(`time ${w.ts} is outside every clip`)
    return start[k] + (w.ts - clips[k].from)
  }

  // Inputs: one per clip (app clips as concat lists of their frames, cards as still images).
  const args = []
  const sorted = [...frames].sort((a, b) => a.ts - b.ts)
  clips.forEach((c, k) => {
    if (c.kind === 'card') {
      args.push('-loop', '1', '-framerate', String(FPS), '-t', c.len.toFixed(3), '-i', join(CAPTION_DIR, `card_${c.name}.png`))
      return
    }
    const first = Math.max(0, sorted.findLastIndex((f) => f.ts <= c.from))
    const used = sorted.slice(first).filter((f, j) => j === 0 || f.ts < c.to)
    const lines = []
    used.forEach((f, j) => {
      const from = Math.max(f.ts, c.from)
      const to = j + 1 < used.length ? used[j + 1].ts : c.to
      if (to - from > 0) lines.push(`file '${f.file.replaceAll('\\', '/')}'`, `duration ${(to - from).toFixed(4)}`)
    })
    lines.push(`file '${used.at(-1).file.replaceAll('\\', '/')}'`)
    const list = join(OUT_DIR, `clip_${k}.txt`)
    writeFileSync(list, lines.join('\n'))
    args.push('-f', 'concat', '-safe', '0', '-i', list)
  })
  const audioBase = clips.length
  for (const c of cues) args.push('-i', c.file)
  const capBase = audioBase + cues.length
  const capInputs = []
  for (const c of captions) {
    const t0 = outTime(c)
    c.stages.forEach((file, k) => {
      const n = c.stages.length
      const from = t0 + (c.rev * k) / n
      const to = k + 1 < n ? t0 + (c.rev * (k + 1)) / n : t0 + c.dur
      capInputs.push({ file, from, to, first: k === 0, last: k + 1 === n, y: c.y, t0 })
    })
  }
  for (const s of capInputs) args.push('-loop', '1', '-framerate', String(FPS), '-t', Math.max(0.05, s.to - s.from).toFixed(3), '-i', s.file)

  const g = []
  clips.forEach((_, k) =>
    g.push(`[${k}:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p,settb=AVTB,trim=duration=${len[k].toFixed(3)},setpts=PTS-STARTPTS[c${k}]`),
  )
  // Transitions: crossfade inside a ride, smooth slide between rides, fades to and from the cards.
  let prev = 'c0'
  for (let k = 1; k < clips.length; k++) {
    const { type, d } = transitions[k - 1]
    g.push(`[${prev}][c${k}]xfade=transition=${type}:duration=${d}:offset=${start[k].toFixed(3)}[x${k}]`)
    prev = `x${k}`
  }
  // Captions: each typing stage in turn; the first fades and slides in, the last fades out.
  capInputs.forEach((s, i) => {
    const fx = [
      'format=rgba',
      s.first ? 'fade=t=in:st=0:d=0.2:alpha=1' : '',
      s.last ? `fade=t=out:st=${Math.max(0, s.to - s.from - 0.25).toFixed(2)}:d=0.25:alpha=1` : '',
      `setpts=PTS+${s.from.toFixed(3)}/TB`,
    ].filter(Boolean)
    g.push(`[${capBase + i}:v]${fx.join(',')}[k${i}]`)
    g.push(`[${prev}][k${i}]overlay=x='(W-w)/2':y='${s.y}+24*max(0,1-(t-${s.t0.toFixed(3)})/0.3)':eof_action=pass:format=auto[o${i}]`)
    prev = `o${i}`
  })
  g.push(`[${prev}]fade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6,format=yuv420p[vout]`)
  // Audio: every voice line with soft edges, placed on the timeline.
  cues.forEach((c, i) => {
    g.push(`[${audioBase + i}:a]afade=t=in:d=0.06,afade=t=out:st=${Math.max(0, c.seconds - 0.12).toFixed(2)}:d=0.12,adelay=${Math.round(outTime(c) * 1000)}:all=1[a${i}]`)
  })
  g.push(`${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:duration=longest,afade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6[aout]`)

  const script = join(OUT_DIR, 'filter.txt')
  writeFileSync(script, g.join(';\n'))
  ffmpeg([
    ...args,
    '-filter_complex_script', script,
    '-map', '[vout]', '-map', '[aout]',
    '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    FINAL,
  ])
  writeFileSync(join(OUT_DIR, 'timeline.json'), JSON.stringify({ total, clips: clips.map((c, k) => ({ ...c, start: start[k], len: len[k] })), transitions }, null, 2))
}

// ---------------------------------------------------------------- run

setTimeout(() => {
  console.error('Timed out after 15 minutes — see the last step logged above.')
  process.exit(1)
}, 900_000).unref()

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health?.ok) {
  console.error(`App not reachable at ${APP_URL} — start the backend and frontend first.`)
  process.exit(2)
}
rmSync(OUT_DIR, { recursive: true, force: true })
for (const d of [AUDIO_DIR, FRAMES_DIR, CAPTION_DIR]) mkdirSync(d, { recursive: true })

log('voiceover: intro + outro…')
const intro = await voice(INTRO, 'intro')
const outro = await voice(OUTRO, 'outro')

// Intro card: the name, the tagline typing in, the intro line spoken over it.
const introLen = intro.seconds + 1.2
addClip({ kind: 'card', name: 'intro', len: introLen })
cues.push({ file: intro.file, seconds: intro.seconds, at: 0.5 })
caption({ at: 0.6 }, introLen - 0.6, 'احكي مشوارك بصوتك،', 'والباقي علينا', 'title', Math.min(2.2, intro.seconds * 0.6), 1240)

for (const [i, ride] of RIDES.entries()) {
  log(`take ${i + 1}/${RIDES.length}: «${ride.rider}»`)
  await recordRide(ride, i)
}

// Outro card: the permanent QR code, the closing line spoken over it.
const outroLen = outro.seconds + 1.8
const outroClip = addClip({ kind: 'card', name: 'outro', len: outroLen }, CARD_IN)

log(`rendering cards and ${captions.length} typed captions…`)
{
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await renderCards(page)
  // Outro texts are placed once the outro's output time is known (below), so they're added here.
  const k = clips.indexOf(outroClip)
  const lens = clips.map((c) => (c.kind === 'card' ? c.len : c.to - c.from))
  let outroStart = 0
  for (let j = 1; j <= k; j++) outroStart += lens[j - 1] - transitions[j - 1].d
  cues.push({ file: outro.file, seconds: outro.seconds, at: outroStart + 0.6 })
  caption({ at: outroStart + 0.7 }, outroLen - 0.8, 'بترا فويس ·', 'احكي وبس', 'title', 0.9, titleSlots.outro ?? 580)
  // The intro title was queued before the cards existed — move it into the measured slot too.
  if (titleSlots.intro) captions.find((c) => c.kind === 'title').y = titleSlots.intro
  await renderCaptions(page)
  await browser.close()
}

log(`editing: ${clips.length} clips, ${frames.length} frames, ${cues.length} voice lines, ${captions.length} captions…`)
exportVideo()
log(`done → ${FINAL}  (${(statSync(FINAL).size / 1e6).toFixed(1)} MB, ${duration(FINAL).toFixed(1)} s)`)
