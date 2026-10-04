// End-to-end test of the voice pipeline against a running backend:
// NLU (Groq LLM) → gate / circle registry → geocoding → route + fare → /api/tts.
//
//   npm run dev            (in another terminal)
//   npm run test:e2e       (API_URL=http://localhost:8000 by default)
//
// Expected coordinates come from src/data/geoKnowledge.ts, the registry the backend itself uses.
// Requests are spaced out: Groq's free tier allows ~8k LLM tokens per minute.

import { GATED_LANDMARKS, JORDAN_CIRCLES } from '../src/data/geoKnowledge.ts'
import { GENERIC_CATEGORIES, LANDMARKS } from '../src/data/landmarks.ts'
import { straightLineKm } from '../src/lib/text.ts'

const API = process.env.API_URL ?? 'http://localhost:8000/api'
const SPACING_MS = Number(process.env.TEST_SPACING_MS ?? 15_000)
/** A pin this close to the registry point is "the same place". */
const TOLERANCE_M = 30
const NOTES_SEPARATOR = ' • '

interface Point { lat: number; lng: number }
interface Place extends Point { name: string; confidence: number }
interface Option extends Point { field: string; name: string }
interface ParseResponse {
  success: boolean
  transcript?: string
  pickup?: Place | null
  dropoff?: Place | null
  rideType?: string
  fareEstimate?: { min: number; max: number; currency: string } | null
  route?: { distanceKm: number } | null
  needsDisambiguation?: boolean
  options?: Option[]
  error?: { code: string; message: string }
}

const circle = (id: string) => {
  const c = JORDAN_CIRCLES.find((x) => x.id === id)
  if (!c) throw new Error(`no circle "${id}" in geoKnowledge.ts`)
  return c
}
const gate = (landmark: string, id: string) => {
  const g = GATED_LANDMARKS[landmark]?.gates.find((x) => x.id === id)
  if (!g) throw new Error(`no gate "${landmark}/${id}" in geoKnowledge.ts`)
  return g
}
const CURRENT_LOCATION = 'موقعي الحالي (عمان)'
const landmark = (id: string) => {
  const l = LANDMARKS.find((x) => x.id === id)
  if (!l) throw new Error(`no landmark "${id}" in landmarks.ts`)
  return l
}
const category = (c: string) => GENERIC_CATEGORIES.find((x) => x.category === c)!.ids.map(landmark)

/** A generic category must ask, with exactly its registry places, in order, at their pins. */
function asksCategory(r: ParseResponse, cat: string, lang: 'ar' | 'en') {
  const expected = category(cat)
  check(r.success === true, 'success', r.error ? `${r.error.code}: ${r.error.message}` : undefined)
  check(r.needsDisambiguation === true, 'asks «قصدك؟»')
  check(r.options?.length === expected.length, `${expected.length} options`, `got ${r.options?.length}`)
  check(Boolean(r.options?.every((o) => o.field === 'dropoff')), 'all for the destination')
  check(r.fareEstimate === null, 'no fare until chosen')
  expected.forEach((l, i) => {
    const o = r.options?.[i]
    const name = lang === 'en' ? l.en : l.name
    check(o?.name === name, `option ${i + 1} = ${name}`, o?.name)
    if (o) near({ ...o, confidence: 1 }, l, `option ${i + 1} pinned`)
  })
}

// ---------------------------------------------------------------- tiny assertion kit

type Check = { ok: boolean; label: string; detail?: string }
const checks: Check[] = []
const check = (ok: boolean, label: string, detail?: string) => checks.push({ ok, label, detail })

const metres = (a: Point, b: Point) => Math.round(straightLineKm(a, b) * 1000)
function near(place: Place | null | undefined, expected: Point, label: string) {
  if (!place) return check(false, label, 'missing')
  const d = metres(place, expected)
  check(d <= TOLERANCE_M, label, `${d} m from ${expected.lat}, ${expected.lng} (got ${place.lat}, ${place.lng})`)
}
const split = (name = '') => {
  const at = name.indexOf(NOTES_SEPARATOR)
  return at < 0 ? { landmark: name, gate: null } : { landmark: name.slice(0, at), gate: name.slice(at + NOTES_SEPARATOR.length) }
}

async function parse(text: string): Promise<ParseResponse> {
  const form = new FormData()
  form.append('text', text)
  const res = await fetch(`${API}/parse-ride`, { method: 'POST', body: form })
  return (await res.json()) as ParseResponse
}

function rideIsComplete(r: ParseResponse) {
  check(r.success === true, 'success', r.error ? `${r.error.code}: ${r.error.message}` : undefined)
  check(r.needsDisambiguation === false, 'no «قصدك؟» needed')
  check(r.fareEstimate?.currency === 'JOD' && r.fareEstimate.min > 0, 'fare in JOD', JSON.stringify(r.fareEstimate))
  check(Boolean(r.route?.distanceKm), 'road route', r.route ? `${r.route.distanceKm} km` : 'route: null')
}

// ---------------------------------------------------------------- cases

const CASES: { title: string; text: string; verify: (r: ParseResponse) => void }[] = [
  {
    title: 'Gate pickup → circle (Arabic)',
    text: 'بدي سيارة من مكة مول بوابة 2 لدوار صويلح',
    verify: (r) => {
      rideIsComplete(r)
      const p = split(r.pickup?.name)
      check(p.landmark === 'مكة مول', 'pickup landmark = مكة مول', r.pickup?.name)
      check(p.gate === 'بوابة 2', 'pickup gate = بوابة 2', String(p.gate))
      near(r.pickup, gate('mecca', 'g2'), 'pickup at Mecca Mall Gate 2')
      check(r.dropoff?.name === 'دوار صويلح', 'dropoff = دوار صويلح («دوار» kept)', r.dropoff?.name)
      near(r.dropoff, circle('sweileh-circle'), 'dropoff on Sweileh Circle')
    },
  },
  {
    title: 'Gate dropoff, no pickup said (Arabic)',
    text: 'وصلني على الجامعة الأردنية البوابة الشمالية',
    verify: (r) => {
      rideIsComplete(r)
      check(r.pickup?.name === CURRENT_LOCATION, 'pickup = current location', r.pickup?.name)
      const d = split(r.dropoff?.name)
      check(d.landmark === 'الجامعة الأردنية', 'dropoff landmark = الجامعة الأردنية', r.dropoff?.name)
      check(Boolean(d.gate?.includes('الشمالية')), 'dropoff gate = الشمالية', String(d.gate))
      near(r.dropoff, gate('ju', 'north'), 'dropoff at UJ North Gate')
    },
  },
  {
    title: 'Nickname circle (Arabic)',
    text: 'خذني على دوار الكيلو',
    verify: (r) => {
      rideIsComplete(r)
      check(r.dropoff?.name === 'دوار الكيلو', 'dropoff = دوار الكيلو', r.dropoff?.name)
      near(r.dropoff, circle('kilo'), 'dropoff on Kilo (Al-Haramain) Circle')
    },
  },
  {
    title: 'English request with ride type',
    text: 'I need an economy ride from City Mall to Seventh Circle',
    verify: (r) => {
      rideIsComplete(r)
      check(r.rideType === 'economy', 'rideType = economy', r.rideType)
      check(r.pickup?.name === 'City Mall', 'pickup named in English', r.pickup?.name)
      check(r.dropoff?.name === '7th Circle', 'dropoff named in English', r.dropoff?.name)
      near(r.dropoff, circle('seventh'), 'dropoff on 7th Circle')
      check(!/[؀-ۿ]/.test(r.transcript ?? ''), 'transcript stays English', r.transcript)
    },
  },
  {
    title: 'Generic category → five hospitals (Arabic)',
    text: 'وصلني ع المستشفى',
    verify: (r) => asksCategory(r, 'hospital', 'ar'),
  },
  {
    title: 'Generic category → five malls (English)',
    text: 'take me to the mall',
    verify: (r) => asksCategory(r, 'mall', 'en'),
  },
  {
    title: 'Tapped option (fast path, no LLM)',
    text: 'إلى مستشفى الخالدي',
    verify: (r) => {
      rideIsComplete(r)
      check(r.pickup?.name === CURRENT_LOCATION, 'pickup = current location', r.pickup?.name)
      check(r.dropoff?.name === 'مستشفى الخالدي', 'dropoff = مستشفى الخالدي', r.dropoff?.name)
      near(r.dropoff, landmark('khalidi'), 'dropoff at Al-Khalidi Hospital')
    },
  },
]

// ---------------------------------------------------------------- TTS

async function ttsCase(lang: 'ar' | 'en', text: string) {
  const t0 = Date.now()
  const res = await fetch(`${API}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, lang }),
  })
  const audio = Buffer.from(await res.arrayBuffer())
  const isMp3 = audio.subarray(0, 3).toString('latin1') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
  check(res.status === 200, `status 200`, `${res.status} in ${Date.now() - t0} ms`)
  check(res.headers.get('content-type')?.startsWith('audio/mpeg') ?? false, 'audio/mpeg', res.headers.get('content-type') ?? '')
  check(isMp3 && audio.length > 5_000, 'valid MP3 audio', `${audio.length} bytes`)
}

// ---------------------------------------------------------------- run

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null)
  if (!health?.ok) {
    console.error(red(`Backend not reachable at ${API} — start it with "npm run dev".`))
    process.exit(2)
  }
  console.log(`Backend: LLM ${health.llm}, STT ${health.sttModel}, TTS ${health.tts}\n`)

  const results: { title: string; failed: Check[]; total: number }[] = []
  const run = async (title: string, body: () => Promise<void>) => {
    const before = checks.length
    try {
      await body()
    } catch (e) {
      check(false, 'no exception', (e as Error).message)
    }
    const mine = checks.slice(before)
    const failed = mine.filter((c) => !c.ok)
    results.push({ title, failed, total: mine.length })
    console.log(`${failed.length ? red('✗') : green('✓')} ${title}`)
    for (const c of mine) console.log(`    ${c.ok ? green('✓') : red('✗')} ${c.label}${c.detail ? `  — ${c.detail}` : ''}`)
  }

  for (const [i, c] of CASES.entries()) {
    if (i > 0) await sleep(SPACING_MS)
    await run(`${i + 1}. ${c.title}: «${c.text}»`, async () => {
      const r = await parse(c.text)
      console.log(`    → ${r.pickup?.name ?? '—'}  ⟶  ${r.dropoff?.name ?? '—'}  (${r.rideType}, ${r.fareEstimate?.min ?? '?'} JOD)`)
      c.verify(r)
    })
  }

  await run('5a. TTS Arabic (male neural voice)', () =>
    ttsCase('ar', 'أبشر، جهزتلك رحلة اقتصادية من مكة مول بوابة 2 إلى دوار صويلح. التكلفة التقديرية 2.45 دينار.'),
  )
  await run('5b. TTS English (male neural voice)', () =>
    ttsCase('en', "All set! I've lined up an Economy ride from City Mall to 7th Circle. Estimated fare is 1.65 JOD."),
  )

  const failedCases = results.filter((r) => r.failed.length)
  const passedChecks = checks.filter((c) => c.ok).length
  console.log(
    `\n${failedCases.length ? red('FAILED') : green('PASSED')}: ${results.length - failedCases.length}/${results.length} cases, ` +
      `${passedChecks}/${checks.length} checks`,
  )
  process.exit(failedCases.length ? 1 : 0)
}

await main()
