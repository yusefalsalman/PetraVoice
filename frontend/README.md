# PetraVoice — Frontend

React + Vite + TypeScript + Tailwind v4. UI spec: [FRONTEND-SPEC.md](FRONTEND-SPEC.md). API contract: [../CLAUDE.md](../CLAUDE.md).

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api → http://localhost:8000)
```

## Mock vs real backend

`.env.local` (copy from `.env.example`):

- `VITE_USE_MOCK=true` — no backend needed; responses come from `src/lib/mockData.ts` after 1.2s.
  - Typed text is parsed against 17 real Amman landmarks (e.g. العبدلي، سيتي مول، الدوار السابع، المطار) with real
    OSRM routes precomputed in `src/lib/mockRoutes.json`. «الجامعة» / «المول» trigger the «قصدك؟» screen.
  - Recorded audio has no STT in mock mode — it always returns the fixed الواحة → الاستقلال ride.
  - `?mock=ambiguous` — forces the "قصدك؟" two-choice case
  - `?mock=error` — forces an `STT_FAILED` error
- `VITE_USE_MOCK=false` — real calls to the Laravel API. Restart `npm run dev` after changing it.

## Notes

- The microphone only works on `localhost` or HTTPS — opening the dev server from a phone via a LAN IP over plain HTTP will block it. Use the text input ("أو اكتب طلبك") or an HTTPS tunnel for phone demos.
- Map: OpenStreetMap tiles (darkened with a CSS filter), no API key.
