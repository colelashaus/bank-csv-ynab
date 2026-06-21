import { useEffect, useRef } from 'react'

// A subtle, non-distracting particle field rendered to a full-viewport canvas
// behind the app. Slow-drifting accent-coloured dots with faint short-range
// connecting lines for a sense of depth. Honours prefers-reduced-motion (draws
// a single static frame) and pauses while the tab is hidden.
export default function Particles() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches

    const rgb = readAccent()
    let particles = []
    let w = 0
    let h = 0
    let raf = 0

    const LINK_DIST = 130

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Scale count to viewport area, capped so it stays light and subtle.
      const count = Math.max(18, Math.min(70, Math.round((w * h) / 24000)))
      particles = Array.from({ length: count }, spawn)
      // Always paint one frame immediately so the field is visible even before
      // the first animation frame (and in tabs where rAF is throttled/hidden).
      draw()
    }

    function spawn() {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: Math.random() * 1.5 + 0.6,
        a: Math.random() * 0.35 + 0.12,
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h)

      // Faint links between nearby particles.
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j]
          const dx = p.x - q.x
          const dy = p.y - q.y
          const dist = Math.hypot(dx, dy)
          if (dist < LINK_DIST) {
            const alpha = (1 - dist / LINK_DIST) * 0.06
            ctx.strokeStyle = `rgba(${rgb},${alpha})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(q.x, q.y)
            ctx.stroke()
          }
        }
      }

      // Dots.
      for (const p of particles) {
        ctx.fillStyle = `rgba(${rgb},${p.a})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function tick() {
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < -5) p.x = w + 5
        else if (p.x > w + 5) p.x = -5
        if (p.y < -5) p.y = h + 5
        else if (p.y > h + 5) p.y = -5
      }
      draw()
      raf = requestAnimationFrame(tick)
    }

    function start() {
      if (reduceMotion) {
        draw()
        return
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }

    function onVisibility() {
      if (document.hidden) cancelAnimationFrame(raf)
      else start()
    }

    resize()
    start()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} className="particles" aria-hidden="true" />
}

// Read the --accent CSS variable and return an "r,g,b" string. Falls back to
// the app's default blue if it can't be parsed.
function readAccent() {
  const fallback = '91,140,255'
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim()
    const m = raw.match(/^#?([0-9a-f]{6})$/i)
    if (!m) return fallback
    const n = parseInt(m[1], 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  } catch {
    return fallback
  }
}
