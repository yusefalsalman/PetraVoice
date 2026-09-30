# PetraVoice — Frontend Spec

> Read `../CLAUDE.md` first for the API contract. This file covers the UI only.
> All user-facing text is in Arabic (RTL). This is a hackathon project — a working demo beats a perfect architecture.

---

## 1. Stack & Libraries

```bash
npm create vite@latest . -- --template react-ts
npm i
npm i tailwindcss @tailwindcss/vite
npm i zustand axios framer-motion lucide-react react-leaflet leaflet @mapbox/polyline
npm i -D @types/leaflet @types/mapbox__polyline
```

| Library | Purpose | Notes |
|---|---|---|
| Vite + React + TS | Foundation | |
| Tailwind CSS v4 | Styling | Add the `@tailwindcss/vite` plugin — no config file needed |
| zustand | State management | One small store. Do not use Redux |
| axios | API calls | |
| framer-motion | Screen transitions, mic button pulse | |
| lucide-react | Icons | |
| react-leaflet + leaflet | Map preview on the confirmation screen | **No API key** — use OpenStreetMap tiles |
| @mapbox/polyline | Decodes the OSRM polyline from `route.geometry` | Precision 5 |

**Do not** add any ready-made audio-recording library. Use the native `MediaRecorder` and `AudioContext` APIs — lighter and faster.

**Font:** Tajawal from Google Fonts (`400, 500, 700`), linked in `index.html`.

---

## 2. File Structure

```
frontend/
├── index.html                 # dir="rtl" lang="ar" + Tajawal font link
├── vite.config.ts             # tailwind plugin + proxy /api → localhost:8000
├── src/
│   ├── main.tsx
│   ├── App.tsx                # routes between screens based on store status
│   ├── index.css              # @import "tailwindcss" + color variables
│   ├── store/
│   │   └── useRideStore.ts    # zustand: state + actions
│   ├── types/
│   │   └── api.ts             # TS types mirroring the API contract exactly
│   ├── lib/
│   │   ├── recorder.ts        # MediaRecorder + AnalyserNode wrapper
│   │   ├── api.ts             # parseRide() / confirmRide() + mock mode
│   │   └── mockData.ts        # success case + ambiguous case
│   ├── screens/
│   │   ├── HomeScreen.tsx     # mic button + waveform
│   │   ├── ProcessingScreen.tsx
│   │   ├── DisambiguationScreen.tsx
│   │   ├── ConfirmScreen.tsx
│   │   └── DispatchedScreen.tsx
│   └── components/
│       ├── MicButton.tsx
│       ├── Waveform.tsx       # canvas driven by AnalyserNode
│       ├── LocationRow.tsx    # icon + place name + confidence badge
│       ├── MapPreview.tsx     # leaflet: two markers + decoded route polyline
│       └── FareCard.tsx
└── .env.local                 # VITE_API_BASE=/api  and  VITE_USE_MOCK=true
```

---

## 3. State Machine

```
idle ──tap──> recording ──stop──> processing ──┐
  ▲                                            ├─ ok ──────────> confirming ──tap──> dispatched
  │                                            ├─ ambiguous ──> disambiguating ──choose──> confirming
  └──────────────── retry ─────────────────────┴─ error ──────> error
```

`useRideStore` holds: `status`, `transcript`, `pickup`, `dropoff`, `rideType`, `fareEstimate`, `options`, `error`.

---

## 4. Implementation Details

### 4.1 Recording (`lib/recorder.ts`)
- `getUserMedia({ audio: true })`, then `new MediaRecorder(stream, { mimeType: 'audio/webm' })`.
- In parallel: `AudioContext` → `createMediaStreamSource` → `AnalyserNode` (`fftSize: 256`) to feed the waveform.
- On stop: produce a `Blob` of type `audio/webm` and stop every track on the stream — otherwise the browser's mic indicator stays on.
- Handle a denied mic permission with a clear Arabic message. Never leave the screen silently doing nothing.
- **Constraint:** only works on `localhost` or HTTPS.

### 4.2 Waveform (`components/Waveform.tsx`)
- `<canvas>` + `requestAnimationFrame` + `getByteFrequencyData`.
- 32–40 bars, each bar's height driven by its frequency bin, rounded caps, smooth motion.
- Cancel the animation frame on unmount.

### 4.3 Mock Mode (`lib/api.ts`)
When `VITE_USE_MOCK=true`, return data from `mockData.ts` after a simulated 1200ms delay instead of hitting the network. This lets every screen be built before the backend exists. Support `?mock=ambiguous` in the URL to force the ambiguity case for testing.

### 4.4 Confirmation Screen
Shows: the transcript as understood, pickup, dropoff, map preview, fare estimate, ride-type selector (economy/comfort/xl), and a large confirm button. Each location must be manually editable — if the AI got it wrong, the user corrects that one field instead of starting over. **Never auto-book.**

### 4.5 Map Preview (`components/MapPreview.tsx`)
- OpenStreetMap tiles: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, with the required attribution string visible — the public tile server requires it.
- Decode `route.geometry` with `polyline.decode()` and render it as a `<Polyline>`.
- **If `route` is null**, draw a straight dashed line between the two markers instead. Never render an empty map.
- Fit bounds to both markers with padding, and disable scroll-wheel zoom so the page doesn't hijack scrolling on mobile.

### 4.6 Disambiguation Screen
Renders exactly two large tappable cards with the Arabic prompt «قصدك؟». Choosing a card fills the field and moves straight to the confirmation screen.

---

## 5. Design

- **RTL:** `dir="rtl"` on `<html>`. Use Tailwind logical properties (`ps-`, `pe-`, `ms-`, `me-`), never `pl-`/`pr-`.
- **Mobile first:** design at 390px width, cap content at `max-width: 480px` and center it on larger screens. The demo will be shown on a phone.
- **Theme:** dark. Deep navy background, light text, one distinctive accent color used for the mic button and the confirm button. Define colors as CSS variables in `index.css`.
- **Motion:** a calm pulse around the mic button while recording, and a short fade+slide transition between screens via framer-motion. Keep it restrained.
- **Accessibility:** Arabic `aria-label` on the mic button, recording state announced via `aria-live`, minimum 44px touch targets. This is a core feature of the product, not a nice-to-have.

---

## 6. Build Order

Implement in this order and stop after each phase so it can be tested:

1. **Setup** — Vite + Tailwind + RTL + font + theme. An empty screen carrying the visual identity.
2. **Types, store, mock layer** — `types/api.ts` matching the contract, zustand store, api layer with mock mode.
3. **Home screen** — mic button + real recording + live waveform. The most important phase visually.
4. **Confirmation screen** — fed from mock data, no map yet.
5. **Disambiguation + dispatched screens** — closes the full demo loop.
6. **Map** — react-leaflet on the confirmation screen.
7. **Real integration** — flip `VITE_USE_MOCK` to false and test against the backend.

Phases 1–5 are the demo. 6 and 7 are enhancements.

---

## 7. Rules

- Never deviate from the field names in `../CLAUDE.md`. If a new field seems necessary, ask first.
- Do not add login, ride history, settings, or any screen not listed above.
- All user-facing copy is in simple Modern Standard Arabic; place examples must be real Amman locations.
- Keep files short and components separated — two people are working on this under time pressure.
