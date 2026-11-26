import type { LogoProps } from '../../core/game'

const PLAIN_TILES = [
  [22, 8], [49, 8], [76, 8],
  [22, 35], [76, 35],
  [22, 62], [49, 62], [76, 62],
] as const

/** A grid of identical tiles with one odd one out in the middle. */
export function ImposterLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="20 4 80 83" aria-hidden="true">
      <g fill="#fffdf6" stroke="#33291c" strokeWidth="3">
        {PLAIN_TILES.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="22" height="21" rx="4" />
        ))}
        <rect
          x="47"
          y="32"
          width="28"
          height="27"
          rx="5"
          fill="#b0432b"
          transform="rotate(10 61 45)"
        />
      </g>
      <path
        d="M55 40c1-7 14-6 12 1-1 4-6 3-6 9"
        fill="none"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="55" r="2.5" fill="#fff" />
    </svg>
  )
}
