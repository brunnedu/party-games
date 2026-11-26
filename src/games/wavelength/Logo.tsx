import type { LogoProps } from '../../core/game'

/** The dial with its scoring areas and a needle. */
export function WavelengthLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="0 4 120 82" aria-hidden="true">
      <g stroke="#33291c" strokeWidth="3" strokeLinejoin="round">
        <path d="M60 74L8 74A52 52 0 0 1 112 74Z" fill="#fffdf6" />
        <path d="M60 74L47.6 23.5A52 52 0 0 1 97.9 38.4Z" fill="#f2c14e" />
        <path d="M60 74L60 22A52 52 0 0 1 88.3 30.4Z" fill="#e8824a" />
        <path d="M60 74L69.4 22.9A52 52 0 0 1 80.3 26.1Z" fill="#4f86a8" />
      </g>
      <path d="M60 74L73 31" stroke="#b0432b" strokeWidth="7" strokeLinecap="round" />
      <circle cx="60" cy="74" r="9" fill="#fffdf6" stroke="#33291c" strokeWidth="3.5" />
    </svg>
  )
}
