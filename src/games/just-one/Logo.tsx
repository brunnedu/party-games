import type { LogoProps } from '../../core/game'

/** Three clue cards: the matching outer ones are struck out, "1" remains. */
export function JustOneLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 120 90" aria-hidden="true">
      <g fill="#fffdf6" stroke="#33291c" strokeWidth="3" strokeLinejoin="round">
        <rect x="10" y="28" width="38" height="50" rx="4" transform="rotate(-16 29 53)" />
        <rect x="72" y="28" width="38" height="50" rx="4" transform="rotate(16 91 53)" />
        <rect x="38" y="10" width="44" height="62" rx="5" />
      </g>
      <path
        d="M52 30l11-9v40"
        fill="none"
        stroke="#b0432b"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 59l22-9M82 50l22 9" stroke="#b0432b" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
