import type { LogoProps } from '../../core/game'

/** Two speech bubbles saying the same thing. */
export function DitoLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="6 6 108 78" aria-hidden="true">
      <g stroke="#33291c" strokeWidth="3" strokeLinejoin="round">
        <path
          d="M18 10H70a8 8 0 0 1 8 8V36a8 8 0 0 1-8 8H36L22 56V44H18a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8Z"
          fill="#fffdf6"
        />
        <path
          d="M50 36H102a8 8 0 0 1 8 8V62a8 8 0 0 1-8 8H98V82L84 70H50a8 8 0 0 1-8-8V44a8 8 0 0 1 8-8Z"
          fill="#fbe3a1"
        />
      </g>
      <g stroke="#b0432b" strokeWidth="5" strokeLinecap="round" fill="none">
        {/* The same two ditto marks in each. */}
        <path d="M37 20l-4 12M53 20l-4 12" />
        <path d="M71 47l-4 12M87 47l-4 12" />
      </g>
    </svg>
  )
}
