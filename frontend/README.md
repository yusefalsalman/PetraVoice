# PetraVoice — Frontend

React + Vite + TypeScript + Tailwind v4. UI spec: [FRONTEND-SPEC.md](FRONTEND-SPEC.md). API contract: [../CLAUDE.md](../CLAUDE.md).

```bash
npm install
npm run dev        # http://localhost:5173 (proxies /api → http://localhost:8000)
```

## Backend

The app needs the backend running on `http://localhost:8000` (`cd ../backend && npm run dev`). `.env.local` (copy from
`.env.example`) only sets `VITE_API_BASE` — leave it at `/api` so the dev server proxies to the backend.

## Notes

- The microphone only works on `localhost` or HTTPS — opening the dev server from a phone via a LAN IP over plain HTTP will block it. Type the destination instead, or use the HTTPS tunnel in `../demo` for phone demos.
- Map: OpenStreetMap tiles (softened with a CSS filter), no API key. Route line and accents use the Petra Ride navy (`--pv-accent` in `src/index.css`).
- Spoken confirmation (`src/lib/speech.ts`): after a ride is mapped and priced, the app reads it back in the rider's language — server voice from `/api/tts`, falling back to the browser's male voice if it's slow or off. On iOS, sound is unlocked on the first tap (WebKit blocks audio that doesn't start in a tap). The 🔈 button in the header mutes it.
- «قصدك؟» screen (`src/screens/DisambiguationScreen.tsx`): 2–5 option cards with a category icon and area hint (`PLACE_AREAS` in `src/lib/i18n.ts`); the heading and spoken question name the category when all options share one («أي مستشفى؟» / "Which hospital?"). Tapping a card re-requests the route (answered without the LLM); «أو قول اسمها بصوتك» reopens the mic.
- Ride-card car images live in `public/cars` (Microsoft Fluent Emoji 3D, MIT — see `LICENSE.txt` there).
