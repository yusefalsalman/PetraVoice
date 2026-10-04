// Points the permanent demo link (https://yusefalsalman.github.io/PetraVoice/) at the tunnel that
// is running now: writes its URL to docs/demo.json, commits only that file and pushes. GitHub Pages
// redeploys in about a minute; docs/index.html then forwards visitors to the new tunnel.
//
// Usage: node publish-link.js https://<name>.trycloudflare.com   (tunnel.js calls this for you)

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PERMANENT_LINK = 'https://yusefalsalman.github.io/PetraVoice/'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'docs', 'demo.json')
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()

/** Publishes `url` behind the permanent link. Returns true when pushed. */
export function publishLink(url) {
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/.test(url)) throw new Error(`not a Cloudflare tunnel URL: ${url}`)
  writeFileSync(FILE, JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  try {
    // Only this file — anything else in progress stays out of the commit.
    git('add', 'docs/demo.json')
    git('commit', '-m', `Live demo link → ${url}`, '--', 'docs/demo.json')
    git('push', 'origin', 'HEAD:main')
    return true
  } catch (e) {
    console.warn(`⚠ Couldn't push the live link: ${String(e.stderr ?? e.message).trim().split('\n').at(-1)}`)
    console.warn(`  The permanent link still points at the previous tunnel. Push docs/demo.json by hand.`)
    return false
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.argv[2]
  if (!url) {
    console.error('Usage: node publish-link.js https://<name>.trycloudflare.com')
    process.exit(1)
  }
  if (publishLink(url)) console.log(`✓ ${PERMANENT_LINK} now forwards to ${url} (live in ~1 min)`)
}
