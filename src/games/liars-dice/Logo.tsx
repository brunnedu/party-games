import type { LogoProps } from '../../core/game'

/** A tipped dice cup with two dice rolling out. */
export function LiarsDiceLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="4 6 112 78" aria-hidden="true">
      <g stroke="#33291c" strokeWidth="3" strokeLinejoin="round">
        {/* The cup, with its leather rim */}
        <g transform="rotate(-38 38 38)">
          <path d="M22 12H54L59 62H17Z" fill="#8a5a33" />
          <path d="M18.5 52H57.5L59 62H17Z" fill="#6b4224" />
          <ellipse cx="38" cy="62" rx="21" ry="5" fill="#33291c" />
        </g>
        <g transform="rotate(-12 72 62)">
          <rect x="57" y="48" width="28" height="28" rx="6" fill="#fffdf6" />
        </g>
        <g transform="rotate(16 98 56)">
          <rect x="85" y="43" width="26" height="26" rx="6" fill="#b0432b" />
        </g>
      </g>
      <g fill="#33291c" transform="rotate(-12 72 62)">
        <circle cx="64" cy="55" r="2.8" />
        <circle cx="71" cy="62" r="2.8" />
        <circle cx="78" cy="69" r="2.8" />
      </g>
      <g fill="#fffdf6" transform="rotate(16 98 56)">
        <circle cx="92" cy="50" r="2.6" />
        <circle cx="104" cy="50" r="2.6" />
        <circle cx="92" cy="62" r="2.6" />
        <circle cx="104" cy="62" r="2.6" />
      </g>
    </svg>
  )
}
