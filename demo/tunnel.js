// One command for demo day: opens a Cloudflare Quick Tunnel to the Vite dev server and prints
// a QR code for it as soon as the public HTTPS URL is known.
// Usage: node tunnel.js            (tunnels http://localhost:5173)
//        node tunnel.js 5173
// Needs: cloudflared on PATH, and both dev servers running (backend :8000, frontend :5173).

import { spawn } from 'node:child_process'
import qrcode from 'qrcode-terminal'
import { PERMANENT_LINK, publishLink } from './publish-link.js'

const port = process.argv[2] ?? '5173'

try {
  await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(3000) })
} catch {
  console.warn(`⚠ Warning: Nothing is responding on http://localhost:${port} yet.`)
  console.warn(`  Start the frontend when ready:  cd frontend && npm run dev\n`)
}
try {
  const health = await (await fetch('http://localhost:8000/api/health', { signal: AbortSignal.timeout(3000) })).json()
  console.log(`Backend OK (${health.provider ?? 'no AI'}, speech-to-text: ${health.stt ? 'on' : 'OFF'})`)
} catch {
  console.warn('⚠ Backend on :8000 is not responding — requests may fail (cd backend && npm run dev).\n')
}

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

function resolveCloudflared() {
  // 1. Try PATH
  try {
    const cmd = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared'
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0]
    if (out && fs.existsSync(out)) return { cmd: out, args: [] }
  } catch {}

  // 2. Check standard Windows install locations
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
      'C:\\Program Files\\cloudflared\\cloudflared.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return { cmd: c, args: [] }
    }
  }

  // 3. Fallback to npx cloudflared
  return { cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--yes', 'cloudflared'] }
}

const resolved = resolveCloudflared()
console.log(`Opening a Cloudflare Quick Tunnel to http://localhost:${port} (${resolved.cmd}) …`)
const tunnelArgs = [...resolved.args, 'tunnel', '--url', `http://localhost:${port}`]
const tunnel = spawn(resolved.cmd, tunnelArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

tunnel.on('error', (e) => {
  console.error(`cloudflared failed: ${e.message}`)
  process.exit(1)
})

let shown = false
const onOutput = (chunk) => {
  const url = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0]
  if (!url || shown) return
  shown = true
  qrcode.generate(url, { small: true }, (qr) => {
    console.log('\n  Scan to open PetraVoice / امسح الرمز لفتح بترا فويس\n')
    console.log(qr)
    console.log(`  ${url}\n`)
    console.log('  Keep this window open — closing it (Ctrl+C) ends the tunnel.')
    console.log('  The URL may take ~10 s to start working after it appears.\n')
  })
  // Point the permanent link (on the slides) at this tunnel.
  if (publishLink(url)) {
    console.log(`  ✓ Permanent link updated: ${PERMANENT_LINK} → ${url}`)
    console.log('    (GitHub Pages refreshes in about a minute — the slides QR then opens this tunnel.)\n')
  }
}
tunnel.stdout.on('data', onOutput)
tunnel.stderr.on('data', onOutput) // cloudflared logs the URL on stderr

const stop = () => {
  tunnel.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
tunnel.on('exit', (code) => {
  if (!shown) console.error(`cloudflared exited (code ${code}) before giving a URL.`)
  process.exit(code ?? 0)
})
