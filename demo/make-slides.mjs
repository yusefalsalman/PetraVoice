// Builds the 6-slide judging deck → ../presentation_slides.pdf (1920×1080 per page, vector text).
//
//   (backend on :8000 and frontend on :5173 running — for the app screenshots)
//   cd demo && npm run slides                                   # slide 5 → permanent link QR (recommended)
//   cd demo && npm run slides -- https://<name>.trycloudflare.com   # slide 5 → one specific tunnel
//   add --fresh to retake the app screenshots (otherwise the saved ones are reused: no API calls)
//
// Steps: screenshot the real app (home, a gate ride, the «أي جامعة؟» choice), make the QR code,
// lay the slides out in HTML, print them to PDF with Chromium.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import QRCode from 'qrcode'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = join(ROOT, 'presentation_slides.pdf')
const ASSETS = join(HERE, 'demo-recordings', 'slides')
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
import { PERMANENT_LINK } from './publish-link.js'

const REPO = 'github.com/yusefalsalman/PromptRider'
const ARGS = process.argv.slice(2)
const LIVE = ARGS.find((a) => a.startsWith('https://')) ?? null
const FRESH = ARGS.includes('--fresh')

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const dataUrl = (file, type = 'image/png') => `data:${type};base64,${readFileSync(file).toString('base64')}`

// ---------------------------------------------------------------- 1. App screenshots

async function screenshots() {
  mkdirSync(ASSETS, { recursive: true })
  const browser = await chromium.launch()
  const shoot = async (name, steps) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-JO', isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.route('**/api/tts', (r) => r.abort()) // no voice needed for stills
    await page.goto(APP_URL)
    await page.getByRole('button', { name: 'اضغط للتحدث بمشوارك' }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile-loaded').length > 4, null, { timeout: 15_000 })
    await steps(page)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(ASSETS, `${name}.png`) })
    await ctx.close()
    log(`screenshot ${name}`)
  }
  const search = async (page, pickup, dropoff) => {
    if (pickup) await page.getByRole('textbox', { name: 'من أين؟' }).fill(pickup)
    await page.getByRole('textbox', { name: 'إلى أين؟' }).fill(dropoff)
    await page.getByRole('button', { name: 'ابحث عن رحلة' }).click()
  }
  await shoot('home', async () => {})
  await shoot('gate', async (page) => {
    await search(page, 'مكة مول بوابة 2', 'دوار صويلح')
    await page.getByRole('button', { name: 'تأكيد الرحلة' }).waitFor({ timeout: 40_000 })
    await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length >= 2)
  })
  await shoot('choice', async (page) => {
    await search(page, '', 'الجامعة')
    await page.getByRole('heading', { name: 'أي جامعة؟' }).waitFor({ timeout: 40_000 })
  })
  await browser.close()
}

// ---------------------------------------------------------------- 2. Slides

const ar = (t) => `<bdi class="ar" dir="rtl">${t}</bdi>`
const phone = (src, caption) =>
  `<figure class="phone"><div class="frame"><img src="${src}" alt=""></div><figcaption>${caption}</figcaption></figure>`

function slides({ home, gate, choice, arch, qr, link, linkLabel }) {
  const head = (n, kicker, title, sub = '') => `
    <div class="top"><span class="brand"><span class="logo">P</span>PetraVoice · Team PromptRiders</span><span class="num">0${n} / 06</span></div>
    <div class="kicker">${kicker}</div>
    <h1>${title}</h1>${sub ? `<p class="lead">${sub}</p>` : ''}`

  return [
    // 1 — Problem
    `<section class="slide">${head(1, 'Problem Statement', 'The Mobility Booking Friction in Jordan', 'Booking a ride still means typing — and global maps don’t speak Amman.')}
      <div class="grid2">
        <div class="card"><div class="ic red">⌨️</div><h3>Typing on the go is slow and unsafe</h3><p>Entering addresses while walking, carrying bags or holding a child means mistakes, delays and eyes off the street.</p></div>
        <div class="card"><div class="ic red">🗣️</div><h3>Global maps don’t understand Jordanian Arabic</h3><p>Local slang and landmark names — ${ar('السابع')}، ${ar('الكيلو')}، ${ar('دوار الواحة')} — are what people say, not what map search expects.</p></div>
        <div class="card"><div class="ic amber">❓</div><h3>Ambiguous requests</h3><p>Riders ask for ${ar('«الجامعة»')} or ${ar('«المستشفى»')} without saying which one — a guess sends the car to the wrong place.</p></div>
        <div class="card"><div class="ic amber">🚪</div><h3>Wrong gate, failed pickup</h3><p>Mecca Mall, City Mall and the University of Jordan have several gates; a pin on the building centre means missed pickups and lost fares.</p></div>
      </div>
    </section>`,

    // 2 — Solution
    `<section class="slide">${head(2, 'Solution &amp; Scope', 'PetraVoice — Conversational AI Mobility Assistant')}
      <div class="split">
        <ul class="checks">
          <li><b>Hands-free voice booking</b> built for Petra Ride riders in Jordan — tap once and speak.</li>
          <li><b>Authentic Jordanian dialect</b> (Ammani colloquial) and English: ${ar('«يعطيك العافية، بدي سيارة من مكة مول بوابة 2 لدوار صويلح»')}</li>
          <li><b>Automatic gate pinpointing</b> — ${ar('«بوابة 2»')} lands on the exact road-side gate, not the roof.</li>
          <li><b>Smart disambiguation</b> — a generic ${ar('«المستشفى»')} or ${ar('«الجامعة»')} gets the top 5 Jordanian options, spoken and on screen.</li>
          <li><b>Ride tiers &amp; live pricing</b> — Economy, Comfort and Family XL priced per trip; a tier said out loud is pre-selected.</li>
          <li><b>Safety by design</b> — the app reads the ride back, but books only after the rider taps confirm.</li>
        </ul>
        <div class="phones">${phone(gate, 'Gate 2 → Sweileh Circle, priced')}${phone(choice, `${ar('«أي جامعة؟»')} — five options`)}</div>
      </div>
    </section>`,

    // 3 — Workflow
    `<section class="slide">${head(3, 'End-to-End User Workflow', 'How the User Experience Flows')}
      <div class="flow">
        <div class="step"><div class="n">1</div><div class="ic blue">🎙️</div><h3>Voice input</h3><p>One tap; MediaRecorder captures the request with a live waveform and sends it after 3 s of silence.</p></div>
        <div class="arrow">→</div>
        <div class="step"><div class="n">2</div><div class="ic blue">🎧</div><h3>Transcription</h3><p>Groq <b>Whisper large-v3</b> turns Jordanian Arabic or English speech into text.</p></div>
        <div class="arrow">→</div>
        <div class="step"><div class="n">3</div><div class="ic blue">🧠</div><h3>Intent &amp; entities</h3><p>Groq <b>gpt-oss-120b</b> extracts pickup, destination, gate and ride type — checked against the actual words.</p></div>
        <div class="arrow">→</div>
        <div class="step"><div class="n">4</div><div class="ic green">📍</div><h3>Hybrid geo resolution</h3><p>Gate &amp; circle registry first, then the landmark base and OpenStreetMap; <b>OSRM</b> computes the route.</p></div>
        <div class="arrow">→</div>
        <div class="step"><div class="n">5</div><div class="ic green">🔊</div><h3>Multi-modal feedback</h3><p>Route on a Leaflet map, fare per tier, and a <b>neural voice</b> reading the ride back.</p></div>
      </div>
      <div class="band">
        <div><b>Vague place?</b> ${ar('«وصلني ع المستشفى»')} → spoken ${ar('«أي مستشفى؟»')} + 5 cards → one tap → route in <b>0.4 s</b> (no extra AI call)</div>
        <div class="pill green">Rider confirms → booking</div>
      </div>
    </section>`,

    // 4 — Architecture
    `<section class="slide">${head(4, 'System Architecture', 'Technical Architecture &amp; Intelligence Stack')}
      <div class="arch">
        <img class="diagram" src="${arch}" alt="PetraVoice system architecture">
        <div class="tiers">
          <div class="tier"><span class="dot" style="--c:#2563eb"></span><div><b>Frontend client</b><p>React 19 · Vite · Tailwind CSS · Leaflet · MediaRecorder API</p></div></div>
          <div class="tier"><span class="dot" style="--c:#7c3aed"></span><div><b>AI cloud engine</b><p>Groq: Whisper large-v3 + gpt-oss-120b, with a 20b model and a rule parser as fallbacks</p></div></div>
          <div class="tier"><span class="dot" style="--c:#0f172a"></span><div><b>Backend engine</b><p>Node.js 24 · Express 5 · fare &amp; ETA engine · SQLite · Cloudflare Tunnel</p></div></div>
          <div class="tier"><span class="dot" style="--c:#10b981"></span><div><b>Geo intelligence</b><p>Curated gate &amp; circle registry + OpenStreetMap (Jordan-only) + OSRM routing</p></div></div>
          <div class="tier"><span class="dot" style="--c:#db2777"></span><div><b>Audio feedback</b><p>Microsoft Edge neural TTS: ar-JO-TaimNeural / ar-SA-HamedNeural · browser fallback</p></div></div>
        </div>
      </div>
    </section>`,

    // 5 — Live demo
    `<section class="slide">${head(5, 'Live Demo', 'Try PetraVoice Live')}
      <div class="demo">
        <div class="qrbox"><img src="${qr}" alt="QR code"><div class="url">${linkLabel}</div><div class="hint">Scan with your phone camera · allow the microphone</div><div class="code">Code: ${REPO}</div></div>
        <div class="prompts">
          <h3>Say one of these after tapping the mic</h3>
          <div class="prompt"><span class="ar big" dir="rtl">«بدي سيارة من مكة مول بوابة 2 لدوار صويلح»</span><span class="tag">exact gate pin + circle</span></div>
          <div class="prompt"><span class="ar big" dir="rtl">«وصلني على الجامعة الأردنية البوابة الشمالية»</span><span class="tag">gate from your current location</span></div>
          <div class="prompt"><span class="ar big" dir="rtl">«بدي أروح على المستشفى»</span><span class="tag">5-choice disambiguation</span></div>
          <div class="prompt"><span class="en big">“Take me from City Mall to the 7th Circle”</span><span class="tag">English works too</span></div>
          <p class="note">One tap → the app listens, maps, prices and reads the ride back. Nothing is booked until you tap <b>Confirm</b>.</p>
        </div>
      </div>
    </section>`,

    // 6 — Testing & roadmap
    `<section class="slide">${head(6, 'Testing, Edge Cases &amp; Roadmap', 'Validation, Current Limitations &amp; Next Steps')}
      <div class="cols3">
        <div class="col green"><h3>✅ What we tested</h3><ul>
          <li>Automated end-to-end suite: <b>9 / 9 passing</b>, every pin checked to within 30 m</li>
          <li>Gate pins: Mecca Mall Gate 2, UJ North Gate; circles incl. Sweileh and ${ar('الكيلو')}</li>
          <li>Dialect, fillers and nicknames; English requests; ride type from speech</li>
          <li>Generic places: 5 hospitals / 5 malls; tapped choice answered without the LLM</li>
          <li>Real speech through the mic pipeline — Whisper transcripts word-for-word</li>
        </ul></div>
        <div class="col amber"><h3>⚠️ Current limitations</h3><ul>
          <li>Needs an internet connection (Groq, OpenStreetMap, OSRM, voice)</li>
          <li>Free-tier AI rate limits; a rule-based parser keeps text requests working</li>
          <li>Curated gates cover key venues; the 6th Circle and three schools await mapping</li>
          <li>Mecca Mall gate numbering to verify on site</li>
        </ul></div>
        <div class="col blue"><h3>🚀 Roadmap</h3><ul>
          <li>Native SDK integration into the Petra Ride passenger app</li>
          <li>Crowd-sourced gate &amp; entrance registry for more venues</li>
          <li>Offline-cached intents for frequent trips</li>
          <li>Driver-side voice navigation to the exact gate</li>
          <li>Aqaba and other cities</li>
        </ul></div>
      </div>
    </section>`,
  ].join('\n')
}

const CSS = String.raw`
  @page { size: 1920px 1080px; margin: 0; }
  :root { --navy:#0f172a; --blue:#2563eb; --green:#10b981; --amber:#f59e0b; --red:#ef4444; --muted:#64748b; --line:#e2e8f0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Inter, Tajawal, sans-serif; color: var(--navy); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ar { font-family: Tajawal, sans-serif; font-weight: 700; }
  .slide { width: 1920px; height: 1080px; padding: 64px 96px; position: relative; overflow: hidden; page-break-after: always;
    background: radial-gradient(1100px 600px at 100% 0%, #dbeafe 0%, transparent 60%), radial-gradient(900px 500px at 0% 100%, #d1fae5 0%, transparent 55%), #f8fafc; }
  .slide::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 14px; background: linear-gradient(var(--blue), var(--green)); }
  .top { display: flex; justify-content: space-between; align-items: center; font-size: 22px; font-weight: 600; color: var(--muted); }
  .brand { display: flex; align-items: center; gap: 14px; }
  .logo { width: 44px; height: 44px; border-radius: 12px; background: var(--navy); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 24px; }
  .num { font-variant-numeric: tabular-nums; }
  .kicker { margin-top: 40px; font-size: 22px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--blue); }
  h1 { font-size: 64px; line-height: 1.08; font-weight: 800; letter-spacing: -.025em; margin-top: 10px; }
  .lead { font-size: 28px; color: var(--muted); margin-top: 14px; }
  h3 { font-size: 28px; font-weight: 800; letter-spacing: -.01em; }
  p, li { font-size: 22px; line-height: 1.45; }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 48px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 24px; padding: 32px 36px; box-shadow: 0 10px 30px rgb(15 23 42 / .06); }
  .card h3 { margin: 18px 0 10px; }
  .card p { color: #334155; }
  .ic { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center; font-size: 32px; }
  .ic.red { background: #fee2e2; } .ic.amber { background: #fef3c7; } .ic.blue { background: #dbeafe; } .ic.green { background: #d1fae5; }

  .split { display: grid; grid-template-columns: 1fr 640px; gap: 56px; margin-top: 40px; align-items: start; }
  .checks { list-style: none; display: flex; flex-direction: column; gap: 22px; }
  .checks li { position: relative; padding-left: 52px; font-size: 25px; color: #334155; }
  .checks li b { color: var(--navy); }
  .checks li::before { content: '✓'; position: absolute; left: 0; top: 2px; width: 34px; height: 34px; border-radius: 50%; background: var(--green); color: #fff; font-weight: 800; font-size: 20px; display: grid; place-items: center; }
  .phones { display: flex; gap: 32px; justify-content: center; }
  .phone { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .frame { width: 300px; height: 650px; border-radius: 44px; padding: 10px; background: var(--navy); box-shadow: 0 24px 60px rgb(15 23 42 / .28); }
  .frame img { width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 34px; display: block; }
  figcaption { font-size: 19px; font-weight: 700; color: var(--muted); }

  .flow { display: flex; align-items: stretch; gap: 14px; margin-top: 64px; }
  .step { flex: 1; background: #fff; border: 1px solid var(--line); border-radius: 24px; padding: 30px 26px; position: relative; box-shadow: 0 10px 30px rgb(15 23 42 / .06); }
  .step .n { position: absolute; top: -22px; left: 26px; width: 44px; height: 44px; border-radius: 50%; background: var(--blue); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 22px; box-shadow: 0 6px 14px rgb(37 99 235 / .35); }
  .step h3 { font-size: 26px; margin: 18px 0 10px; }
  .step p { font-size: 20px; color: #334155; }
  .arrow { align-self: center; font-size: 40px; color: var(--blue); font-weight: 800; }
  .band { margin-top: 56px; display: flex; align-items: center; justify-content: space-between; gap: 32px; background: var(--navy); color: #fff; border-radius: 24px; padding: 30px 40px; font-size: 25px; }
  .pill { white-space: nowrap; padding: 12px 26px; border-radius: 999px; font-weight: 800; font-size: 22px; }
  .pill.green { background: var(--green); color: var(--navy); }

  .arch { display: grid; grid-template-columns: 1fr 470px; gap: 40px; margin-top: 34px; align-items: start; }
  .diagram { width: 100%; border-radius: 20px; border: 1px solid var(--line); box-shadow: 0 16px 40px rgb(15 23 42 / .12); }
  .tiers { display: flex; flex-direction: column; gap: 16px; }
  .tier { display: flex; gap: 16px; align-items: flex-start; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 18px 20px; }
  .tier b { font-size: 22px; }
  .tier p { font-size: 18px; color: #475569; margin-top: 4px; line-height: 1.4; }
  .dot { flex: none; width: 16px; height: 16px; margin-top: 7px; border-radius: 5px; background: var(--c); }

  .demo { display: grid; grid-template-columns: 560px 1fr; gap: 64px; margin-top: 44px; align-items: start; }
  .qrbox { background: #fff; border-radius: 32px; padding: 36px; text-align: center; box-shadow: 0 20px 50px rgb(15 23 42 / .12); border: 1px solid var(--line); }
  .qrbox img { width: 440px; height: 440px; }
  .url { margin-top: 18px; font-size: 24px; font-weight: 800; color: var(--blue); word-break: break-all; }
  .hint { margin-top: 10px; font-size: 19px; color: var(--muted); }
  .code { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 18px; font-weight: 600; color: var(--muted); }
  .prompts h3 { margin-bottom: 22px; }
  .prompt { display: flex; align-items: center; justify-content: space-between; gap: 24px; background: #fff; border: 1px solid var(--line); border-radius: 20px; padding: 20px 28px; margin-bottom: 16px; }
  .prompt .big { font-size: 32px; }
  .prompt .en { font-weight: 700; font-size: 28px; }
  .tag { white-space: nowrap; font-size: 18px; font-weight: 700; color: var(--green); background: #d1fae5; padding: 8px 16px; border-radius: 999px; }
  .note { margin-top: 24px; font-size: 23px; color: #334155; }

  .cols3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 48px; }
  .col { background: #fff; border-radius: 24px; padding: 32px 34px; border: 1px solid var(--line); border-top: 8px solid var(--c); box-shadow: 0 10px 30px rgb(15 23 42 / .06); }
  .col.green { --c: var(--green); } .col.amber { --c: var(--amber); } .col.blue { --c: var(--blue); }
  .col ul { margin-top: 20px; padding-left: 26px; display: flex; flex-direction: column; gap: 14px; }
  .col li { font-size: 21px; color: #334155; }
  .col li::marker { color: var(--c); }
`

// ---------------------------------------------------------------- run

setTimeout(() => { console.error('Timed out after 5 minutes.'); process.exit(1) }, 300_000).unref()

const shots = ['home', 'gate', 'choice'].map((n) => join(ASSETS, `${n}.png`))
if (FRESH || !shots.every((f) => existsSync(f))) {
  log('screenshots of the running app…')
  await screenshots()
} else log('reusing the saved app screenshots (--fresh to retake)')

// The permanent link forwards to whichever tunnel `npm run tunnel` started last.
const link = LIVE ?? PERMANENT_LINK
const qr = await QRCode.toDataURL(link, { width: 880, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Tajawal:wght@500;700;800&display=block" rel="stylesheet">
<style>${CSS}</style></head><body>${slides({
  home: dataUrl(join(ASSETS, 'home.png')),
  gate: dataUrl(join(ASSETS, 'gate.png')),
  choice: dataUrl(join(ASSETS, 'choice.png')),
  arch: dataUrl(join(ROOT, 'architecture_diagram.png')),
  qr,
  link,
  linkLabel: link.replace('https://', '').replace(/\/$/, ''),
})}</body></html>`
writeFileSync(join(ASSETS, 'slides.html'), html)

log('printing the PDF…')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: OUT, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true })
// PNG previews of each slide, for a quick visual check.
for (let i = 0; i < 6; i++) {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.evaluate((y) => window.scrollTo(0, y), i * 1080)
  await page.screenshot({ path: join(ASSETS, `slide_${i + 1}.png`), clip: { x: 0, y: i * 1080, width: 1920, height: 1080 }, fullPage: true })
}
await browser.close()
log(`done → ${OUT}  (slide 5 points to ${link})`)
