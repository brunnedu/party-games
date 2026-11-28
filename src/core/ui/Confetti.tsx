import { useEffect, useRef } from 'react'

const COLORS = ['#b0432b', '#3d6b3a', '#e8b83e', '#4f86a8', '#d9798f']
/** How quickly the air slows a piece down, per second. Higher is a sharper pop. */
const DRAG = 3.2

interface Piece {
  x: number
  y: number
  /** Launch speed in pixels per second; positive vy points up. */
  vx: number
  vy: number
  /** The speed the piece settles into while falling. */
  fallSpeed: number
  delay: number
  life: number
  width: number
  height: number
  round: boolean
  color: string
  angle: number
  spin: number
  flip: number
  flipSpeed: number
  sway: number
  swaySpeed: number
}

const between = (min: number, max: number) => min + Math.random() * (max - min)

/** The launch speed that carries a piece `rise` pixels up against drag and gravity. */
function launchSpeed(rise: number, fallSpeed: number) {
  const target = rise * DRAG
  let low = 0
  let high = target + 10 * fallSpeed
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2
    if (mid - fallSpeed * Math.log1p(mid / fallSpeed) < target) low = mid
    else high = mid
  }
  return high
}

/** Two cannons in the bottom corners, aimed at the top center of the screen. */
function createPieces(width: number, height: number): Piece[] {
  const size = Math.sqrt(width * height)
  const perSide = Math.round(Math.min(130, Math.max(70, size / 7)))
  const scale = Math.min(1.35, Math.max(1, size / 700))

  return Array.from({ length: 2 * perSide }, (_, i) => {
    const fromLeft = i % 2 === 0
    const fallSpeed = height * between(0.2, 0.36)
    // Where the piece tops out. The square root favors the upper end, and
    // reaching past the middle lets the two bursts mix.
    const rise = height * (0.3 + 0.65 * Math.sqrt(Math.random()))
    // Higher pieces fly further inwards, which keeps each burst a diagonal jet.
    const reach = width * (rise / height) * between(0.12, 0.85)

    const vy = launchSpeed(rise, fallSpeed)
    const timeToTop = Math.log1p(vy / fallSpeed) / DRAG
    const vx = (reach * DRAG) / (1 - Math.exp(-DRAG * timeToTop))

    const shape = Math.random()
    const streamer = shape > 0.85
    const round = shape < 0.15
    const base = between(7, 11) * scale

    return {
      x: fromLeft ? -8 : width + 8,
      y: height + 8,
      vx: fromLeft ? vx : -vx,
      vy,
      fallSpeed,
      delay: between(0, 0.18),
      life: between(2.8, 4.2),
      width: streamer ? base * 0.4 : base,
      height: streamer ? base * 2.2 : round ? base : base * 1.4,
      round,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      angle: between(0, 2 * Math.PI),
      spin: between(-6, 6),
      flip: between(0, 2 * Math.PI),
      flipSpeed: between(5, 13),
      sway: between(5, 22) * scale,
      swaySpeed: between(2.5, 5.5),
    }
  })
}

/** Draws one piece `t` seconds after its launch. */
function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, t: number, dpr: number) {
  // How much of the launch has been used up, from 0 to 1.
  const spent = 1 - Math.exp(-DRAG * t)
  // The flutter only sets in once the piece has lost its speed.
  const x = p.x + (p.vx * spent) / DRAG + p.sway * spent ** 4 * Math.sin(p.swaySpeed * t + p.flip)
  const y = p.y - ((p.vy + p.fallSpeed) * spent) / DRAG + p.fallSpeed * t
  // Turning over: the piece gets narrow, then shows its shaded back.
  const face = Math.cos(p.flip + p.flipSpeed * t)

  ctx.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr)
  ctx.rotate(p.angle + p.spin * t)
  ctx.scale(1, Math.max(0.12, Math.abs(face)))
  ctx.globalAlpha = Math.min(1, (p.life - t) / 0.8)

  ctx.beginPath()
  if (p.round) ctx.arc(0, 0, p.width / 2, 0, 2 * Math.PI)
  else ctx.rect(-p.width / 2, -p.height / 2, p.width, p.height)
  ctx.fillStyle = p.color
  ctx.fill()
  if (face < 0) {
    ctx.fillStyle = 'rgb(0 0 0 / 22%)'
    ctx.fill()
  }
}

/** Paper snippets shot in from both bottom corners, once. Hidden when the device
    asks for less motion. */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // The global CSS rule can't stop a canvas, so ask here.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    // More than 2 costs frames on phones and is hard to see on moving paper.
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pieces = createPieces(canvas.clientWidth, canvas.clientHeight)
    let start: number | undefined
    let frame = requestAnimationFrame(function draw(now) {
      start ??= now
      const elapsed = (now - start) / 1000

      // Follow rotation and Safari's collapsing toolbar.
      const width = Math.round(canvas.clientWidth * dpr)
      const height = Math.round(canvas.clientHeight * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, width, height)

      let flying = false
      for (const piece of pieces) {
        const t = elapsed - piece.delay
        if (t >= piece.life) continue
        flying = true
        if (t >= 0) drawPiece(ctx, piece, t, dpr)
      }
      if (flying) frame = requestAnimationFrame(draw)
      // Done: give the memory back, as the canvas may stay on screen for long.
      else canvas.width = canvas.height = 0
    })

    return () => cancelAnimationFrame(frame)
  }, [])

  return <canvas ref={ref} className="confetti" aria-hidden />
}
