# Demo day — share PetraVoice with the judges, and record the demo video

Phones only allow the microphone on **HTTPS**, so the app is shared through a Cloudflare Quick Tunnel
(free, no account, no warning page). The app calls the relative path `/api`, so on a phone every request
goes `https://<tunnel>/api` → Vite's proxy → the backend on this laptop. Nothing points at `localhost`.

## One-time setup

```bash
winget install --id Cloudflare.cloudflared
cd demo && npm install
```

Open a **new** terminal after installing so `cloudflared` is on the PATH.

## On stage (3 terminals)

```bash
cd backend && npm run dev
cd frontend && npm run dev
cd demo && npm run tunnel
```

`npm run tunnel` checks both servers, opens the tunnel, prints a QR code for the projector, and points the
**permanent link** at it. Keep that window open — closing it ends the tunnel.

**Permanent link:** `https://yusefalsalman.github.io/PromptRider/` (GitHub Pages, `docs/`). Each tunnel gets a
new random URL, so `publish-link.js` writes it to `docs/demo.json` and pushes it; the page forwards visitors
there about a minute later. Use this link on slides and printed QR codes — it never changes.
One-time setup: the repo must be public and GitHub Pages enabled (Settings → Pages → Deploy from a branch →
`main` / `/docs`).

Already have a URL? `npm run qr -- https://<name>.trycloudflare.com` just prints its QR code.

Raw command, if you prefer: `cloudflared tunnel --url http://localhost:5173`

## Demo videos (fully automated)

With the backend and frontend running:

```bash
npm run record              # landscape 1920×1080 → ../backend/demo_video_final.mp4
npm run record:vertical     # vertical 9:16 1080×1920, captions + camera moves → ../backend/demo_video_vertical_final.mp4
```

Each run (~3–5 min, 4 Groq requests):

1. Generates the Jordanian voiceover with Edge neural TTS (`ar-JO-TaimNeural`).
2. Records three real voice bookings in headless Chromium — each request is played into the **fake
   microphone**, so it goes through Whisper and the LLM like a real rider: Mecca Mall **Gate 2** → Sweileh
   Circle, a **Family XL** ride to the airport, and «وصلني على الجامعة» → the **«أي جامعة؟»** choice.
3. Speaks each reply with the **real fare** of that run, said the Jordanian way.
4. Cuts the dead time and merges everything with FFmpeg (`ffmpeg-static`). The vertical cut adds
   Chromium-rendered Arabic captions, zoompan camera moves and scene dips, exported at 60 fps.

Edit the rides, voice lines and captions in the `RIDES` list at the top of `record-demo.mjs` /
`record-vertical.mjs`. Raw frames and audio go to `demo-recordings/` (git-ignored). Playwright downloads
Chromium on first use (`npx playwright install chromium`).
