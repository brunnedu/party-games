/** The app's mark. public/favicon.svg is the same drawing. */
export function Die({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <g transform="rotate(-12 20 20)">
        <rect
          x="7"
          y="7"
          width="26"
          height="26"
          rx="7"
          fill="#b0432b"
          stroke="#33291c"
          strokeWidth="2.5"
        />
        <g fill="#fffdf6">
          <circle cx="14" cy="14" r="2.6" />
          <circle cx="20" cy="20" r="2.6" />
          <circle cx="26" cy="26" r="2.6" />
        </g>
      </g>
    </svg>
  )
}
