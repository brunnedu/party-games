import type { LogoProps } from '../../core/game'

/** A sentence card with its gap blacked out. */
export function WalterLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="6 6 108 78" aria-hidden="true">
      <rect
        x="12"
        y="12"
        width="96"
        height="66"
        rx="6"
        fill="#fffdf6"
        stroke="#33291c"
        strokeWidth="3"
        transform="rotate(-3 60 45)"
      />
      <path
        d="M24 28H94M24 63H72"
        stroke="#8a7655"
        strokeWidth="5"
        strokeLinecap="round"
        transform="rotate(-3 60 45)"
      />
      <g transform="rotate(-6 60 46)">
        <rect x="8" y="35" width="104" height="21" fill="#1c1710" />
        <text
          x="60"
          y="51"
          textAnchor="middle"
          fill="#fffdf6"
          fontFamily="ui-monospace, Consolas, monospace"
          fontSize="16"
          fontWeight="700"
          // A fixed width, whatever monospace font the device has.
          textLength="82"
          lengthAdjust="spacingAndGlyphs"
        >
          WALTER
        </text>
      </g>
    </svg>
  )
}
