// Vertical (9:16, 1080×1920) commercial-style demo: Jordanian voiceover, real voice bookings in the
// running app, animated Arabic captions, camera zooms / pans, soft scene dips, 60 fps export.
//
//   (backend on :8000 and frontend on :5173 running)
//   cd demo && npm run record:vertical        → backend/demo_video_vertical_final.mp4
//
// Capture: back-to-back screenshots of a 432×768 phone viewport re-rendered at 2.5× = 1080×1920
// (Playwright's recordVideo and the CDP screencast stay at CSS-pixel size in headless Chromium).
// That gives ≈10 new frames per second of the app itself; everything added in FFmpeg — camera
// moves, caption slides, fades — is computed for every one of the 60 frames per second.
//
// Captions are rendered by Chromium (Tajawal, correct Arabic shaping) as transparent PNGs and
// animated with FFmpeg overlays.

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const OUT_DIR = join(HERE, 'demo-recordings', 'vertical')
const AUDIO_DIR = join(OUT_DIR, 'audio')
const FRAMES_DIR = join(OUT_DIR, 'frames')
const CAPTION_DIR = join(OUT_DIR, 'captions')
const FINAL = resolve(HERE, '..', 'backend', 'demo_video_vertical_final.mp4')
const VOICE = 'ar-JO-TaimNeural' // Jordanian male neural voice
const VIEWPORT = { width: 432, height: 768 } // 9:16 phone layout…
const SCALE = 2.5 // …rendered at 2.5× → exactly 1080×1920
const W = VIEWPORT.width * SCALE
const H = VIEWPORT.height * SCALE
const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }
const CAPTION_Y = 215 // output px, just under the app header

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
    riderCaption: 'بدي سيارة من مكة مول بوابة 2 لدوار صويلح',
    expect: (b) => b.pickup?.name?.includes('بوابة 2') && b.dropoff?.name?.includes('صويلح'),
    typed: { pickup: 'مكة مول بوابة 2', dropoff: 'دوار صويلح' },
    reply: (fare) => `أبشر، من مكة مول بوابة 2 لدوار صويلح، بحدود ${fare}.`,
    focus: '.pv-pin--pickup',
    results: [
      { text: 'تحديد البوابة تلقائياً: ', accent: 'مكة مول · بوابة 2', at: 0.5, dur: 2.7 },
      { text: 'رسم المسار المباشر ', accent: 'لدوار صويلح', at: 3.3, dur: 2.5 },
      { text: 'تأكيد فوري ', accent: 'بالصوت والتسعيرة', at: 6.0, dur: 2.6 },
    ],
  },
  {
    id: 'family',
    rider: 'بدنا سيارة عائلية من الدوار السابع للمطار، واحنا خمس أشخاص.',
    riderCaption: 'بدنا سيارة عائلية من الدوار السابع للمطار',
    expect: (b) => b.rideType === 'xl' && b.dropoff?.name?.includes('مطار'),
    typed: { pickup: 'الدوار السابع', dropoff: 'مطار الملكة علياء سيارة عائلية' },
    reply: (fare) => `على راسي، سيارة عائلية للمطار، بحدود ${fare}.`,
    focus: 'fieldset button[aria-pressed="true"]', // the XL card the voice picked
    results: [{ text: 'نوع السيارة من كلامك: ', accent: 'عائلي XL', at: 0.5, dur: 3.2 }],
  },
  {
    id: 'ambiguous',
    rider: 'وصلني على الجامعة لو سمحت.',
    riderCaption: 'وصلني على الجامعة',
    expect: (b) => b.needsDisambiguation === true && b.options?.length === 5,
    typed: { pickup: '', dropoff: 'الجامعة' },
    ask: 'أي جامعة حاب تروح عليها؟ اختار من الخيارات.',
    askCaption: { text: 'أي جامعة؟ ', accent: 'خمس خيارات بلمسة' },
    choose: 'الجامعة الأردنية',
    reply: (fare) => `تمام، ع البوابة الشمالية للأردنية، بحدود ${fare}.`,
    focus: '.pv-pin--dropoff',
    results: [{ text: 'الجامعة الأردنية · ', accent: 'البوابة الشمالية', at: 0.5, dur: 3.0 }],
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

// ---------------------------------------------------------------- Timeline (wall-clock seconds)

const frames = [] // { ts, file }
const keep = [] // [from, to] ranges that make the cut, in order
const cues = [] // { file, ts, seconds } voice tracks
const captions = [] // { text, accent, kind, ts, dur }
const camera = [] // { ts, z, x, y } — x/y in CSS px of the page

const cam = (ts, z, p = CENTER) => camera.push({ ts, z, x: p.x, y: p.y })
const caption = (ts, dur, text, accent = '', kind = 'info') => captions.push({ ts, dur, text, accent, kind })

async function centerOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null)
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
}

// ---------------------------------------------------------------- One take = one browser session

async function take(micWav, run) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${micWav}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
      '--enable-gpu-rasterization',
      '--enable-webgl',
    ],
  })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    permissions: ['microphone'],
    locale: 'ar-JO',
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const shot = { format: 'jpeg', quality: 92, optimizeForSpeed: true, clip: { x: 0, y: 0, ...VIEWPORT, scale: SCALE } }
  const screenshot = () =>
    Promise.race([cdp.send('Page.captureScreenshot', shot), sleep(3000).then(() => { throw new Error('screenshot timeout') })])

  await page.goto(APP_URL)
  await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 4, null, { timeout: 15_000 })
  await sleep(400) // settle

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
  cues.push({ file: line.file, ts: now() + 0.1, seconds: line.seconds })
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
  await page.getByRole('textbox', { name: 'من أين؟' }).fill(typed.pickup)
  await page.getByRole('textbox', { name: 'إلى أين؟' }).fill(typed.dropoff)
  const retry = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
  await page.getByRole('button', { name: 'ابحث عن رحلة' }).click({ force: true })
  return (await retry).json()
}

// ---------------------------------------------------------------- The rides

async function recordRide(ride, i, intro, outro) {
  const rider = await voice(ride.rider, `${ride.id}_rider`)
  const micWav = micInput(rider.file, ride.id)

  await take(micWav, async (page) => {
    const start = now()
    if (i === 0) {
      // Transition 1 — hero: slow push-out over the home screen while the intro plays.
      cam(start, 1.12)
      caption(start + 0.3, intro.seconds - 0.2, 'بترا فويس · ', 'احكي مشوارك بصوتك')
      await narrate(intro, 0.2)
      cam(now(), 1.0)
    } else {
      cam(start, 1.0)
      await sleep(700)
    }

    // Transition 2 — zoom towards the mic and the listening bar while the rider speaks.
    const micCenter = (await centerOf(page, 'button[aria-label="اضغط للتحدث بمشوارك"]')) ?? { x: CENTER.x, y: VIEWPORT.height - 80 }
    // Centred, and gentle: the app's content runs to 16 px from the edges, so the full-width listening
    // bar and the right-aligned title only fit up to ≈1.06×.
    const micFocus = { x: CENTER.x, y: micCenter.y - 90 }
    const parsed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
    const tap = now()
    cam(tap, 1.0)
    await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).click({ force: true })
    cues.push({ file: rider.file, ts: tap + 0.45, seconds: rider.seconds })
    caption(tap + 0.5, rider.seconds, `«${ride.riderCaption}»`, '', 'quote')
    cam(tap + 1.0, 1.05, micFocus)
    const spokenEnd = tap + 0.45 + rider.seconds + 0.8
    cam(spokenEnd, 1.06, micFocus)
    let body = await (await parsed).json()
    log(`  heard «${body.transcript}» → ${body.pickup?.name ?? '—'} ⟶ ${body.dropoff?.name ?? (body.needsDisambiguation ? 'قصدك؟' : '—')} (${body.rideType})`)
    keep.push([start, spokenEnd]) // the silence wait and server call are cut

    if (!ride.expect(body)) {
      log('  ⚠ not what was asked — typing it instead for this take')
      body = await typeInstead(page, ride.typed)
    }

    if (ride.ask) {
      await page.getByRole('heading', { name: 'أي جامعة؟' }).waitFor({ state: 'visible', timeout: 30_000 })
      const shown = now() - 0.3
      keep.push([shown, Infinity])
      cam(shown, 1.0)
      caption(shown + 0.3, 3.4, ride.askCaption.text, ride.askCaption.accent)
      await narrate(await voice(ride.ask, `${ride.id}_ask`), 0.1)
      const refreshed = page.waitForResponse((r) => r.url().includes('/api/parse-ride'), { timeout: 60_000 })
      await page.locator('button', { hasText: ride.choose }).first().click({ force: true })
      cam(now(), 1.0)
      keep.at(-1)[1] = now() + 0.6
      body = await (await refreshed).json()
      log(`  chose «${ride.choose}» → ${body.dropoff?.name}`)
    }

    const result = await routeOnScreen(page)
    keep.push([result - 0.8, Infinity])
    const fare = body.fareEstimate?.min
    log(`  fare ${body.fareEstimate?.min}–${body.fareEstimate?.max} JOD → «${jordanianFare(fare)}»`)

    // Transition 3 — pan & zoom onto the key result (gate pin / ride cards / destination gate),
    // Transition 4 — zoom back out to the whole route and the car cards.
    const focus = (await centerOf(page, ride.focus)) ?? CENTER
    const focusZoom = ride.focus.startsWith('fieldset') ? 1.9 : 1.75
    cam(result - 0.8, 1.0)
    cam(result + 0.2, 1.0)
    cam(result + 1.3, focusZoom, focus)
    cam(result + 3.3, focusZoom, focus)
    cam(result + 4.6, 1.0)
    for (const c of ride.results) caption(result + c.at, c.dur, c.text, c.accent)

    const reply = await voice(ride.reply(jordanianFare(fare)), `${ride.id}_reply`)
    await narrate(reply, 0.3)
    const holdUntil = result + Math.max(5.2, ...ride.results.map((c) => c.at + c.dur + 0.3))
    if (now() < holdUntil) await sleep((holdUntil - now()) * 1000)
    cam(now(), 1.0)

    if (ride.last) {
      // Closing shot: pull the sheet down; slow push-in on the whole route.
      await page.getByRole('button', { name: 'إخفاء التفاصيل لعرض الخريطة كاملة' }).click({ force: true })
      await sleep(700)
      const t = now()
      cam(t, 1.0)
      caption(t + 0.2, outro.seconds + 0.4, 'بترا فويس · ', 'احكي وبس')
      await narrate(outro, 0.9)
      cam(now(), 1.1, { x: CENTER.x, y: CENTER.y - 40 })
    }
    keep.at(-1)[1] = now()
  })
}

// ---------------------------------------------------------------- Captions → transparent PNGs

async function renderCaptions() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W, height: 400 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html dir="rtl"><head>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;800&display=block" rel="stylesheet">
    <style>
      html, body { margin: 0; background: transparent; }
      #wrap { display: inline-block; padding: 26px 30px 34px; }
      .pill { display: inline-flex; align-items: center; gap: 18px; max-width: 940px; padding: 20px 38px 22px;
        border-radius: 999px; font: 800 44px/1.3 Tajawal, sans-serif; white-space: nowrap;
        box-shadow: 0 14px 34px rgb(0 0 0 / 0.32), 0 2px 6px rgb(0 0 0 / 0.18); }
      .info { background: rgb(0 23 75 / 0.95); color: #fff; border: 2px solid rgb(255 255 255 / 0.14); }
      .info .accent { color: #6ee7b7; }
      .dot { width: 16px; height: 16px; flex: none; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 7px rgb(52 211 153 / 0.25); }
      .quote { background: rgb(255 255 255 / 0.97); color: #00174b; font-weight: 700; border: 3px solid #00174b; }
      .mic { width: 40px; height: 40px; flex: none; border-radius: 50%; background: #00174b; display: grid; place-items: center; }
    </style></head><body><div id="wrap"></div></body></html>`)
  await page.evaluate(() => document.fonts.ready)

  const mic = '<span class="mic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg></span>'
  for (const [i, c] of captions.entries()) {
    const html =
      c.kind === 'quote'
        ? `<div class="pill quote">${mic}<span>${c.text}</span></div>`
        : `<div class="pill info"><span class="dot"></span><span>${c.text}<span class="accent">${c.accent}</span></span></div>`
    await page.evaluate((h) => (document.getElementById('wrap').innerHTML = h), html)
    await page.evaluate(() => document.fonts.ready)
    c.file = join(CAPTION_DIR, `cap_${i}.png`)
    await page.locator('#wrap').screenshot({ path: c.file, omitBackground: true })
  }
  await browser.close()
}

// ---------------------------------------------------------------- Edit & export

/** Wall-clock → output time through the kept ranges. */
function videoTime(ts) {
  let t = 0
  for (const [a, b] of keep) {
    if (ts < a) return t
    if (ts <= b) return t + (ts - a)
    t += b - a
  }
  return t
}

/** Piecewise smoothstep through keyframes [{t, v}] as an FFmpeg expression of `variable`. */
function eased(keys, variable) {
  const k = keys.filter((p, i) => i === 0 || p.t > keys[i - 1].t + 1e-3)
  let expr = k.at(-1).v.toFixed(4)
  for (let i = k.length - 2; i >= 0; i--) {
    const { t: a, v: va } = k[i]
    const { t: b, v: vb } = k[i + 1]
    const s = `clip((${variable}-${a.toFixed(3)})/${(b - a).toFixed(3)},0,1)`
    const seg = `${va.toFixed(4)}+(${(vb - va).toFixed(4)})*${s}*${s}*(3-2*${s})`
    expr = `if(lt(${variable},${b.toFixed(3)}),${seg},${expr})`
  }
  return `if(lt(${variable},${k[0].t.toFixed(3)}),${k[0].v.toFixed(4)},${expr})`
}

function exportVideo() {
  // Frames → concat list (each frame shown until the next capture), across the kept ranges.
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
  lines.push(`file '${last.file.replaceAll('\\', '/')}'`)
  const list = join(OUT_DIR, 'frames.txt')
  writeFileSync(list, lines.join('\n'))

  const total = keep.reduce((s, [a, b]) => s + (b - a), 0)
  const cuts = []
  keep.reduce((t, [a, b]) => (cuts.push(t), t + (b - a)), 0)
  cuts.shift() // no dip at the very start

  // Camera keyframes in output time (zoom, focus point in output pixels).
  const keys = camera
    .map((c) => ({ t: videoTime(c.ts), z: c.z, x: c.x * SCALE, y: c.y * SCALE }))
    .sort((a, b) => a.t - b.t)
  const Z = eased(keys.map((k) => ({ t: k.t, v: k.z })), 'it')
  const X = eased(keys.map((k) => ({ t: k.t, v: k.x })), 'it')
  const Y = eased(keys.map((k) => ({ t: k.t, v: k.y })), 'it')

  // Inputs: 0 = frames, 1..n = voice cues, then caption PNGs.
  const args = ['-f', 'concat', '-safe', '0', '-i', list]
  for (const c of cues) args.push('-i', c.file)
  const capBase = 1 + cues.length
  for (const c of captions) args.push('-loop', '1', '-framerate', '60', '-t', (c.dur + 0.1).toFixed(2), '-i', c.file)

  const g = []
  // Video: constant 60 fps → camera (zoompan, every output frame) → captions → scene dips → fades.
  g.push(
    `[0:v]fps=60,scale=${W}:${H}:flags=lanczos,setsar=1,` +
      `zoompan=z='${Z}':x='max(0,min(iw-iw/zoom,(${X})-iw/zoom/2))':y='max(0,min(ih-ih/zoom,(${Y})-ih/zoom/2))':d=1:s=${W}x${H}:fps=60[cam]`,
  )
  let prev = 'cam'
  captions.forEach((c, i) => {
    const t0 = videoTime(c.ts)
    const d = c.dur
    g.push(
      `[${capBase + i}:v]format=rgba,fade=t=in:st=0:d=0.28:alpha=1,fade=t=out:st=${(d - 0.28).toFixed(2)}:d=0.28:alpha=1,setpts=PTS+${t0.toFixed(3)}/TB[c${i}]`,
    )
    g.push(
      `[${prev}][c${i}]overlay=x='(W-w)/2':y='${CAPTION_Y}+26*max(0,1-(t-${t0.toFixed(3)})/0.35)':eof_action=pass:format=auto[v${i}]`,
    )
    prev = `v${i}`
  })
  const dip = cuts.length ? cuts.map((c) => `max(0,1-abs(t-${c.toFixed(3)})/0.15)`).reduce((a, b) => `max(${a},${b})`) : '0'
  g.push(
    `[${prev}]eq=brightness='-0.85*(${dip})':eval=frame,fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,format=yuv420p[vout]`,
  )
  // Audio: each voice line with soft edges, placed on the timeline.
  cues.forEach((c, i) => {
    const out = Math.max(0, c.seconds - 0.12).toFixed(2)
    g.push(`[${i + 1}:a]afade=t=in:d=0.06,afade=t=out:st=${out}:d=0.12,adelay=${Math.round(videoTime(c.ts) * 1000)}:all=1[a${i}]`)
  })
  g.push(`${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:duration=longest,afade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5[aout]`)

  const script = join(OUT_DIR, 'filter.txt')
  writeFileSync(script, g.join(';\n'))
  ffmpeg([
    ...args,
    '-filter_complex_script', script,
    '-map', '[vout]', '-map', '[aout]',
    '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    FINAL,
  ])
  writeFileSync(join(OUT_DIR, 'timeline.json'), JSON.stringify({ total, cuts, keep, camera: keys, captions: captions.map((c) => ({ ...c, at: videoTime(c.ts) })) }, null, 2))
}

// ---------------------------------------------------------------- run

setTimeout(() => {
  console.error('Timed out after 12 minutes — see the last step logged above.')
  process.exit(1)
}, 720_000).unref()

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
for (const [i, ride] of RIDES.entries()) {
  log(`take ${i + 1}/${RIDES.length}: «${ride.rider}»`)
  await recordRide(ride, i, intro, outro)
}
log(`rendering ${captions.length} captions…`)
await renderCaptions()
log(`editing: ${frames.length} frames, ${cues.length} voice lines, ${camera.length} camera keyframes…`)
exportVideo()
log(`done → ${FINAL}  (${(statSync(FINAL).size / 1e6).toFixed(1)} MB, ${duration(FINAL).toFixed(1)} s)`)
