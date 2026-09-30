import { useEffect, useRef } from 'react'

const MAX_BARS = 36
const MIN_BARS = 12
const GAP = 4

interface Props {
  analyser: AnalyserNode | null
  /** Bar colour; defaults to the theme accent. */
  color?: string
  className?: string
}

/** Live frequency bars driven by an AnalyserNode. Draws a calm idle line when there is no analyser. */
export default function Waveform({ analyser, color: colorProp, className = 'h-14 w-full' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const color = colorProp ?? (getComputedStyle(canvas).getPropertyValue('--pv-accent').trim() || '#00174b')
    const bins = new Uint8Array(analyser?.frequencyBinCount ?? 0)
    const heights = new Float32Array(MAX_BARS)
    let frame = 0

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth: w, clientHeight: h } = canvas
      if (canvas.width !== w * dpr) canvas.width = w * dpr
      if (canvas.height !== h * dpr) canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Fewer bars in narrow spaces so each stays readable (~5px+).
      const bars = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.floor((w + GAP) / 9)))
      const barW = (w - GAP * (bars - 1)) / bars
      if (barW <= 0) {
        // Not laid out yet (e.g. mid screen transition) — try again next frame.
        frame = requestAnimationFrame(draw)
        return
      }
      if (analyser) analyser.getByteFrequencyData(bins)
      // Voice energy sits in the lower bins — use the first ~70%.
      const usable = Math.floor(bins.length * 0.7)

      ctx.fillStyle = color
      for (let i = 0; i < bars; i++) {
        // Mirror from the centre so the shape is symmetric.
        const mirrored = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2)
        const bin = usable ? bins[Math.floor(mirrored * (usable - 1))] / 255 : 0
        const target = Math.max(barW, bin * h * 0.95)
        heights[i] += (target - heights[i]) * 0.3 // smooth motion
        const bh = heights[i]
        const x = i * (barW + GAP)
        ctx.globalAlpha = analyser ? 0.55 + 0.45 * bin : 0.35
        ctx.beginPath()
        ctx.roundRect(x, (h - bh) / 2, barW, bh, barW / 2)
        ctx.fill()
      }
      frame = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(frame)
  }, [analyser, colorProp])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
