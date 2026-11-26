import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { BANDS } from './scoring'
import { s } from './strings.de'

// The dial is a half circle in SVG units. Position 0 is left, 100 is right.
const CX = 100
const CY = 100
const RADIUS = 92

function point(position: number, radius: number) {
  const angle = Math.PI * (1 - position / 100)
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)] as const
}

function wedge(from: number, to: number, radius = RADIUS) {
  const [x1, y1] = point(from, radius)
  const [x2, y2] = point(to, radius)
  return `M${CX} ${CY}L${x1} ${y1}A${radius} ${radius} 0 0 1 ${x2} ${y2}Z`
}

const clamp = (value: number) => Math.min(100, Math.max(0, value))

/** The scoring areas around the target, widest first. */
function Zones({ target }: { target: number }) {
  return (
    <g className="zones">
      {[...BANDS].reverse().map((band) => (
        <path
          key={band.points}
          className={`zone zone-${band.points}`}
          // Half a step wider, so the edge position clearly lies inside.
          d={wedge(clamp(target - band.within - 0.5), clamp(target + band.within + 0.5))}
        />
      ))}
      {BANDS.flatMap((band, i) => {
        const inner = i === 0 ? 0 : BANDS[i - 1]!.within
        const offsets = i === 0 ? [0] : [-1, 1].map((side) => (side * (inner + band.within)) / 2)
        return offsets
          .map((offset) => target + offset)
          .filter((position) => position >= 0 && position <= 100)
          .map((position) => {
            const [x, y] = point(position, RADIUS - 10)
            return (
              <text key={position} x={x} y={y} className="zone-label">
                {band.points}
              </text>
            )
          })
      })}
    </g>
  )
}

export interface Marker {
  id: string
  position: number
  icon: string
  color: string
}

export function Dial({
  value,
  target,
  reveal,
  markers = [],
  onChange,
  onCommit,
}: {
  /** The needle; omitted to show no needle. */
  value?: number
  /** Draws the scoring areas. Only pass it when it may be seen. */
  target?: number | null
  /** Turns a cover away to uncover the scoring areas. */
  reveal?: boolean
  markers?: Marker[]
  /** Makes the needle draggable. */
  onChange?: (value: number) => void
  /** The needle was let go. */
  onCommit?: (value: number) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const latest = useRef(value ?? 50)
  const dragging = useRef(false)
  const interactive = Boolean(onChange)

  function positionAt(e: PointerEvent) {
    const matrix = svg.current!.getScreenCTM()!.inverse()
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
    // Below the baseline counts as the nearer end.
    if (p.y > CY) return p.x < CX ? 0 : 100
    const angle = Math.atan2(CY - p.y, p.x - CX)
    return clamp(Math.round((1 - angle / Math.PI) * 100))
  }

  function change(next: number) {
    latest.current = next
    onChange?.(next)
  }

  function drop() {
    if (!dragging.current) return
    dragging.current = false
    onCommit?.(latest.current)
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]
    const jump = { PageDown: -10, PageUp: 10, Home: -100, End: 100 }[e.key]
    if (step === undefined && jump === undefined) return
    e.preventDefault()
    dragging.current = true
    change(clamp((value ?? 50) + (step ?? jump!)))
  }

  const [tipX, tipY] = point(value ?? 50, RADIUS - 4)

  return (
    <svg
      ref={svg}
      className={interactive ? 'dial interactive' : 'dial'}
      viewBox="0 0 200 112"
      {...(interactive && {
        role: 'slider',
        tabIndex: 0,
        'aria-label': s.dialLabel,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': value,
        onPointerDown: (e: PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          change(positionAt(e))
        },
        onPointerMove: (e: PointerEvent) => {
          if (dragging.current) change(positionAt(e))
        },
        onPointerUp: drop,
        onPointerCancel: drop,
        onKeyDown,
        onKeyUp: drop,
        onBlur: drop,
      })}
    >
      <path className="dial-face" d={wedge(0, 100)} />
      {Array.from({ length: 21 }, (_, i) => {
        const [x1, y1] = point(i * 5, RADIUS)
        const [x2, y2] = point(i * 5, RADIUS - (i % 5 === 0 ? 6 : 3))
        return <line key={i} className="dial-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      {target != null && <Zones target={target} />}
      {reveal && <path className="dial-cover" d={wedge(0, 100, RADIUS + 1)} />}
      {markers.map((m, i) => {
        // Alternating distances keep close markers readable.
        const radius = 74 - (i % 3) * 17
        const [x, y] = point(m.position, radius)
        const [ex, ey] = point(m.position, RADIUS)
        return (
          <g key={m.id} className="marker">
            <line x1={x} y1={y} x2={ex} y2={ey} stroke="#33291c" strokeWidth="1.2" />
            <circle cx={x} cy={y} r="8" fill={m.color} stroke="#33291c" strokeWidth="1.2" />
            <text x={x} y={y} className="marker-icon">
              {m.icon}
            </text>
          </g>
        )
      })}
      {value !== undefined && (
        <g className="needle">
          <line x1={CX} y1={CY} x2={tipX} y2={tipY} />
          {interactive && <circle className="needle-grip" cx={tipX} cy={tipY} r="6.5" />}
        </g>
      )}
      <circle className="dial-hub" cx={CX} cy={CY} r="9" />
    </svg>
  )
}
