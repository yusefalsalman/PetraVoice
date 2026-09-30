# Demo day — share PetraVoice with the judges

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

`npm run tunnel` checks both servers, opens the tunnel and prints a QR code for the projector. Keep that
window open — closing it ends the tunnel. A new URL is generated every time it starts.

Already have a URL? `npm run qr -- https://<name>.trycloudflare.com` just prints its QR code.

Raw command, if you prefer: `cloudflared tunnel --url http://localhost:5173`
