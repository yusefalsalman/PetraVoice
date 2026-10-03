# PetraVoice — Backend

Node.js 24 + TypeScript + Express 5. Implements the API contract in [../CLAUDE.md](../CLAUDE.md).

```bash
cp .env.example .env     # then put your GROQ_API_KEY in .env
npm install
npm run dev              # http://localhost:8000  (Node runs the .ts files directly)
npm run typecheck
npm run test:e2e         # end-to-end pipeline test (backend must be running)
```

The frontend's Vite dev server proxies `/api` → `http://localhost:8000`.

## Pipeline — `POST /api/parse-ride`

1. **Input** — multipart `audio` (webm / mp4 / wav / mp3 / ogg, ≤ 10 MB) or `text` (skips STT).
2. **Speech-to-text** — Whisper (Groq `whisper-large-v3` or OpenAI `whisper-1`), language `STT_LANGUAGE`
   (default `auto`: Arabic or English detected from the audio). Sentences Whisper adds in the *other* language
   (a stray translation) are dropped, so the app answers in the language the rider spoke.
3. **Understanding** — LLM function calling (Groq `openai/gpt-oss-120b` by default), **Arabic or English**
   (any word order; fillers like «يا غالي» / "hey man" ignored). Returns the request language and, for pickup and
   dropoff: a clean typo-corrected name («فاسل» → «فيصل», «التكنو» → JUST, «الكيلو» → «دوار الكيلو»; circle names
   keep «دوار»), the gate apart («بوابة 2», "North Gate", «جهة تلاع العلي» — never sent to geocoding), up to 4 map search candidates
   in both languages (specific → broad) and the surrounding area. No key / LLM failure → rule-based parser
   (also bilingual).
   Place names come back in the request's language (`en` names in `src/data/landmarks.ts`, Nominatim
   `accept-language`). Error messages stay Arabic per the contract — the frontend shows English ones by code.
4. **Geocoding cascade** (`src/services/geocode.ts`):
   - L0 gate & circle registry (`src/data/geoKnowledge.ts`, OSM-verified): Amman's traffic circles are pinned
     on the roundabout, and a named gate of a known landmark (Mecca Mall 1–3, City Mall main / parking, UJ
     main / north / agriculture / engineering) moves the pin to that gate: «مكة مول • بوابة 2». Unknown gates
     stay as a note after « • » at the landmark's pin.
   - L1 local landmark KB (SQLite, `src/data/landmarks.ts`) — exact, contained (unless the extra words name
     another facility: «مستشفى الجامعة الأردنية» ≠ the university) or typo-tolerant (closest name, 1–2 letters off,
     no guess on ties). Candidates that only name the area are kept for L4, not trusted as the place.
   - L2 Nominatim (`countrycodes=jo`, Amman-biased, 1 req/s — sequential by policy, cached) with the candidates
     in order: full name → official English OSM name → keyword variant → area anchor
   - L3 keyword stripping («دوار», «مستشفى», "Circle"…) and city context («عمان» / "Amman", the area, «الأردن»)
   - L3b Photon fuzzy search (all candidates in parallel), restricted to Jordan by bbox + country code, and a hit
     must share a real word with the query (type words like «فندق» / "hotel" don't count)
   - L4 the area centre, named «… (المنطقة - موقع تقريبي)» at confidence 0.75
   Matches too far from the place's area are rejected: 6 km (neighbourhood the rider said), 15 km (city said),
   12 km (area only inferred by the LLM). Vague words or two similar hits →
   `needsDisambiguation` with exactly two options. **Location problems never return 422**: a side that
   can't be placed at all comes back `null` and the app asks the rider to fill it in.
5. **Routing** — OSRM driving route (precision-5 polyline). Any failure → `route: null`.
6. **Fare** — 0.40 JOD + 0.25 JOD/km (min 1.00), +15% upper range; Comfort ×1.35, Family XL ×1.70.
   `fareEstimate` is for the returned `rideType`; the frontend scales it for the other tiers.

No pickup said → the rider's current location (`CURRENT_LOCATION` in `src/data/landmarks.ts`,
kept in sync with `frontend/src/lib/location.ts`).

## `POST /api/confirm-ride`

Validates the body, stores the booking in SQLite (`data/petravoice.db`), returns
`PV-<year>-<nnnnn>`, `status: "dispatched"` and a simulated 3–7 minute ETA.

## `POST /api/tts`

`{ text, lang: "ar" | "en" }` → `audio/mpeg`: the spoken ride confirmation the frontend composes.
`TTS_PROVIDER=edge` (default, Microsoft Edge neural voices `TTS_VOICE_AR` / `TTS_VOICE_EN`, no key),
`openai` (`tts-1`, needs `OPENAI_API_KEY`) or `none` (answers 501; the browser speaks instead). Text is capped
at 300 characters; the last 30 results are cached. Not part of the parse / confirm contract.

## Other

- `GET /api/health` — shows the STT / LLM models and the TTS voice in use.
- Errors are always `{ success: false, error: { code, message } }` with Arabic messages.
- Add gates and circles in `src/data/geoKnowledge.ts`, other landmarks in `src/data/landmarks.ts`; they're
  re-seeded on every start.
