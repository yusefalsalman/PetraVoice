// Prints a scannable QR code for a URL in the terminal (for the projector).
// Usage: node generate-qr.js https://something.trycloudflare.com

import qrcode from 'qrcode-terminal'

const url = process.argv[2]

if (!url || !/^https:\/\//.test(url)) {
  console.error('Usage: node generate-qr.js https://<your-tunnel>.trycloudflare.com')
  console.error('(Must be https — phones only allow the microphone on secure pages.)')
  process.exit(1)
}

qrcode.generate(url, { small: true }, (qr) => {
  console.log('\n  Scan to open PetraVoice / امسح الرمز لفتح بترا فويس\n')
  console.log(qr)
  console.log(`  ${url}\n`)
})
