import type { LogoProps } from '../../core/game'

/** A combination lock showing a three-digit code. */
export function DecodoLogo({ className }: LogoProps) {
  return (
    <svg className={className} viewBox="6 6 108 78" aria-hidden="true">
      <path
        d="M40 40V29a20 20 0 0 1 40 0v11"
        fill="none"
        stroke="#33291c"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <rect
        x="17" y="38" width="86" height="42" rx="9"
        fill="#fbe3a1" stroke="#33291c" strokeWidth="3"
      />
      {[
        { x: 25, digit: '4', color: '#b0432b' },
        { x: 50, digit: '2', color: '#33291c' },
        { x: 75, digit: '1', color: '#3a5f8a' },
      ].map(({ x, digit, color }) => (
        <g key={x}>
          <rect
            x={x} y="46" width="20" height="26" rx="3"
            fill="#fffdf6" stroke="#33291c" strokeWidth="2"
          />
          <text
            x={x + 10}
            y="66"
            textAnchor="middle"
            fill={color}
            fontFamily="ui-monospace, Consolas, monospace"
            fontSize="20"
            fontWeight="700"
          >
            {digit}
          </text>
        </g>
      ))}
    </svg>
  )
}
