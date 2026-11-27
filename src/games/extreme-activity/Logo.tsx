import type { LogoProps } from '../../core/game'

/** A racing stopwatch with a lightning bolt. */
export function ExtremeActivityLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="2 2 96 80" aria-hidden="true">
      <g stroke="#33291c" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        <path d="M52 8H68M60 8V16M82 24L88 18" fill="none" />
        <circle cx="60" cy="48" r="31" fill="#b0432b" />
        <circle cx="60" cy="48" r="23" fill="#fffdf6" />
        <path d="M64 30L48 51H59L55 67L73 43H62Z" fill="#fbe3a1" />
        {/* Speed lines */}
        <path d="M8 36H20M6 50H18M10 64H20" fill="none" />
      </g>
    </svg>
  )
}
