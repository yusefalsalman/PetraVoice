// Renders the PetraVoice system architecture as a 2400×1400 PNG (../architecture_diagram.png).
//
//   cd demo && npm run diagram
//
// Plain HTML + CSS boxes; the arrows are drawn as SVG after layout from the boxes' real positions,
// then Playwright screenshots the 1200×700 page at 2× scale.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'architecture_diagram.png')

const item = (id, icon, title, sub) =>
  `<div class="item" id="${id}"><div class="t"><span class="i">${icon}</span>${title}</div><div class="s">${sub}</div></div>`

const html = String.raw`<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Tajawal:wght@500;700&display=block" rel="stylesheet">
<style>
  :root { --navy:#00174b; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 700px; overflow: hidden; font-family: Inter, Tajawal, sans-serif; color: var(--ink);
    background: radial-gradient(1200px 500px at 85% -10%, #e0e7ff 0%, transparent 60%), radial-gradient(900px 500px at -10% 110%, #dcfce7 0%, transparent 55%), #f8fafc; }
  .ar { font-family: Tajawal, sans-serif; font-weight: 700; }
  header { position: absolute; left: 24px; right: 24px; top: 16px; height: 52px; display: flex; align-items: center; gap: 14px; }
  .logo { width: 44px; height: 44px; border-radius: 12px; background: var(--navy); color: #fff; display: grid; place-items: center; font: 800 24px Inter; box-shadow: 0 6px 16px rgb(0 23 75 / .25); }
  h1 { font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
  h1 span { color: var(--navy); }
  .sub { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .badge { white-space: nowrap; margin-inline-start: auto; display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: #fff; border: 1.5px solid #fecaca; color: #b91c1c; font-size: 11.5px; font-weight: 700; box-shadow: 0 2px 8px rgb(0 0 0 / .05); }
  .panel { position: absolute; border-radius: 18px; background: rgb(255 255 255 / .82); border: 1.5px solid var(--c); box-shadow: 0 10px 30px rgb(15 23 42 / .07); padding: 12px; }
  .panel > h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 12.5px; font-weight: 800; letter-spacing: .01em; color: var(--c); margin-bottom: 9px; text-transform: uppercase; }
  .panel > h2 small { flex-basis: 100%; padding-inline-start: 17px; text-transform: none; font-weight: 600; color: var(--muted); font-size: 10.5px; letter-spacing: 0; }
  .panel > h2::before { content: ''; width: 9px; height: 9px; border-radius: 3px; background: var(--c); }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; gap: 26px; }
  .row .item { flex: 1; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 30px; }
  .item { background: #fff; border: 1px solid var(--line); border-left: 4px solid var(--c); border-radius: 11px; padding: 8px 10px; box-shadow: 0 2px 6px rgb(15 23 42 / .05); }
  .item .t { font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
  .item .i { font-size: 14px; }
  .item .s { font-size: 10px; color: var(--muted); margin-top: 3px; line-height: 1.35; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
  .chip { font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--c) 12%, #fff); color: var(--c); }
  footer { position: absolute; left: 24px; right: 24px; bottom: 16px; height: 46px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 12px; border-radius: 14px; background: var(--navy); color: #fff; font-size: 11px; font-weight: 600; }
  footer b { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #34d399; color: var(--navy); font-size: 10px; font-weight: 800; margin-inline-end: 4px; }
  footer .step { display: flex; align-items: center; white-space: nowrap; }
  footer .arrow { opacity: .45; margin: 0 3px; }
  svg { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  .lbl { font: 700 9.5px Inter, sans-serif; }
</style></head><body>

<header>
  <div class="logo">P</div>
  <div>
    <h1>PetraVoice <span>· System Architecture</span></h1>
    <div class="sub">Hyper-local AI voice ride booking for Amman · Jordan 2076 Hackathon · Aqaba 2076 Track · Team PromptRiders</div>
  </div>
  <div class="badge">🛡️ No automatic booking · the rider confirms on screen</div>
</header>

<section class="panel" style="--c:#0369a1; left:24px; top:84px; width:240px; height:532px">
  <h2>Client Layer <small>React 19 · Vite · Tailwind v4</small></h2>
  <div class="stack">
    ${item('rec', '🎙️', 'Voice recorder', 'MediaRecorder · live waveform · auto-send after 3 s of silence')}
    ${item('map', '🗺️', 'Leaflet map', 'OpenStreetMap tiles · navy route · gate pins')}
    ${item('cards', '🚗', '3D ride cards', 'Economy · Comfort · Family XL, fare per tier')}
    ${item('choose', '🔀', 'Choice cards', '2–5 options with area hints · tap or say one')}
    ${item('state', '⚙️', 'Ride state machine', 'Zustand: idle → recording → processing → choose → confirm → dispatched')}
    ${item('speaker', '🔊', 'Spoken read-back', 'plays the confirmation · mute toggle · AR (RTL) / EN (LTR) UI')}
  </div>
</section>

<section class="panel" style="--c:#ea580c; left:280px; top:84px; width:170px; height:216px">
  <h2>Edge <small>public access</small></h2>
  <div class="stack">
    ${item('cf', '☁️', 'Cloudflare Tunnel', 'public HTTPS for the phone mic · QR code for judges')}
    ${item('proxy', '🔁', 'Vite proxy', '/api → backend :8000 · one origin')}
  </div>
</section>

<section class="panel" style="--c:#db2777; left:280px; top:316px; width:170px; height:300px">
  <h2>Audio Feedback <small>male neural voices</small></h2>
  <div class="stack">
    ${item('edge', '🗣️', 'Edge Neural TTS', 'Microsoft neural voices: ar-SA-HamedNeural · ar-JO-TaimNeural · en-US-ChristopherNeural')}
    ${item('webspeech', '🔈', 'Web Speech fallback', 'browser male voice if the server is slow · iOS audio unlocked on first tap')}
  </div>
</section>

<section class="panel" style="--c:#00174b; left:466px; top:84px; width:250px; height:532px">
  <h2>Core Backend <small>Node.js 24 · Express 5 · stateless REST</small></h2>
  <div class="stack">
    ${item('parse', '📥', 'POST /api/parse-ride', 'audio or text → pickup · dropoff · ride type · route · fare · options')}
    ${item('fare', '💰', 'Fare &amp; ETA engine', '0.40 + 0.25 JOD/km (min 1.00) · Comfort ×1.35 · XL ×1.70 · OSRM time')}
    ${item('tts', '🔊', 'POST /api/tts', 'confirmation sentence → MP3 · rider’s language · cached')}
    ${item('confirm', '✅', 'POST /api/confirm-ride', 'only after the rider taps confirm → PV-2026-xxxxx')}
    ${item('db', '🗄️', 'SQLite (node:sqlite)', 'landmarks &amp; aliases · geocode cache · bookings')}
  </div>
</section>

<section class="panel" style="--c:#7c3aed; left:732px; top:84px; width:444px; height:214px">
  <h2>AI &amp; Speech Pipeline <small>Groq · OpenAI-compatible API</small></h2>
  <div class="row">
    ${item('whisper', '🎧', 'Whisper large-v3', 'speech-to-text · auto Arabic / English · Amman-biased')}
    ${item('llm', '🧠', 'LLM entity &amp; gate parser', 'gpt-oss-120b → 20b → rules · dialect, nicknames, ride type · grounded')}
    ${item('ambig', '🔀', 'Ambiguity engine', 'generic place → top 5 · similar → 2 · tapped choice skips the LLM')}
  </div>
</section>

<section class="panel" style="--c:#059669; left:732px; top:330px; width:444px; height:286px">
  <h2>Hybrid Geo Layer <small>OpenStreetMap data</small></h2>
  <div class="grid">
    ${item('reg', '🚪', 'Gate &amp; circle registry', 'OSM-verified road-side gates · Amman’s traffic circles')}
    ${item('kb', '📚', 'Landmark knowledge base', 'aliases · typos · English names · category top 5')}
    ${item('osrm', '🛣️', 'OSRM routing', 'driving route · encoded polyline (precision 5)')}
    ${item('osm', '🔎', 'Nominatim + Photon', 'Jordan-only · Amman-biased · cached · 1 req/s')}
  </div>
</section>

<footer>
  <span class="step"><b>1</b>Speak</span><span class="arrow">→</span>
  <span class="step"><b>2</b>Whisper STT</span><span class="arrow">→</span>
  <span class="step"><b>3</b>LLM: places · gates · ride type</span><span class="arrow">→</span>
  <span class="step"><b>4</b>Registry → KB → OSM</span><span class="arrow">→</span>
  <span class="step"><b>5</b>OSRM route + fare</span><span class="arrow">→</span>
  <span class="step"><b>6</b>Screen + spoken read-back</span><span class="arrow">→</span>
  <span class="step"><b>7</b>Rider confirms → booking</span>
</footer>

<svg id="wires"><defs></defs></svg>

<script>
  // Arrows between boxes, from their real positions after layout.
  const svg = document.getElementById('wires'), defs = svg.querySelector('defs')
  const marker = (color) => {
    const id = 'm' + color.slice(1)
    if (!document.getElementById(id)) defs.insertAdjacentHTML('beforeend',
      '<marker id="' + id + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + color + '"/></marker>')
    return 'url(#' + id + ')'
  }
  const anchor = (id, side, f = 0.5) => {
    const r = document.getElementById(id).getBoundingClientRect()
    return { right: [r.right, r.top + r.height * f], left: [r.left, r.top + r.height * f], top: [r.left + r.width * f, r.top], bottom: [r.left + r.width * f, r.bottom] }[side]
  }
  const normal = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] }
  function wire(a, as, b, bs, color, label, opts = {}) {
    const [x1, y1] = anchor(a, as, opts.from), [x2, y2] = anchor(b, bs, opts.to)
    const k = opts.bend ?? Math.max(24, Math.hypot(x2 - x1, y2 - y1) * 0.35)
    const c1 = [x1 + normal[as][0] * k, y1 + normal[as][1] * k], c2 = [x2 + normal[bs][0] * k, y2 + normal[bs][1] * k]
    const d = 'M' + x1 + ',' + y1 + ' C' + c1 + ' ' + c2 + ' ' + x2 + ',' + y2
    const m = marker(color)
    svg.insertAdjacentHTML('beforeend', '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round"' +
      (opts.dash ? ' stroke-dasharray="5 4"' : '') + ' marker-end="' + m + '"' + (opts.both ? ' marker-start="' + m + '"' : '') + '/>')
    if (label) {
      const t = 0.5, mt = 1 - t
      const px = mt ** 3 * x1 + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * x2
      const py = mt ** 3 * y1 + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * y2
      const [dx, dy] = opts.labelOffset ?? [0, 0]
      const w = label.length * 5.4 + 12
      svg.insertAdjacentHTML('beforeend', '<g transform="translate(' + (px + dx) + ',' + (py + dy) + ')"><rect x="' + (-w / 2) + '" y="-9" width="' + w +
        '" height="18" rx="9" fill="#fff" stroke="' + color + '" stroke-width="1.2"/><text class="lbl" text-anchor="middle" y="3.4" fill="' + color + '">' + label + '</text></g>')
    }
  }
  const N = '#00174b', P = '#7c3aed', G = '#059669', O = '#ea580c', K = '#db2777'
  wire('rec', 'right', 'cf', 'left', O, 'HTTPS', { both: true })
  wire('cf', 'bottom', 'proxy', 'top', O, '', { bend: 12 })
  wire('proxy', 'right', 'parse', 'left', O, '/api', { both: true })
  wire('parse', 'right', 'whisper', 'left', P, 'audio')
  wire('whisper', 'right', 'llm', 'left', P, '', { bend: 12 })
  wire('llm', 'right', 'ambig', 'left', P, '', { bend: 12 })
  wire('llm', 'bottom', 'reg', 'top', G, 'places + gates', { from: 0.35, to: 0.85 })
  wire('reg', 'right', 'kb', 'left', G, '', { bend: 14 })
  wire('kb', 'bottom', 'osm', 'top', G, '', { bend: 14 })
  wire('osm', 'left', 'osrm', 'right', G, '', { bend: 14 })
  wire('osrm', 'left', 'fare', 'right', G, 'route')
  wire('parse', 'bottom', 'fare', 'top', N, '', { bend: 8 })
  wire('confirm', 'bottom', 'db', 'top', N, '', { bend: 8 })
  wire('tts', 'left', 'edge', 'right', K, 'MP3')
  wire('edge', 'left', 'speaker', 'right', K, '')
  document.body.dataset.ready = '1'
</script>
</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForSelector('body[data-ready="1"]')
await page.screenshot({ path: OUT })
await browser.close()
console.log(`saved ${OUT}`)
