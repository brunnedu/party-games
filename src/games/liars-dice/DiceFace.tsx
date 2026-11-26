// Pip positions on a 3×3 grid.
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
}

export function DiceFace({
  value,
  highlight,
  dim,
}: {
  value: number
  highlight?: boolean
  dim?: boolean
}) {
  const classes = ['dice-face', highlight && 'highlight', dim && 'dim'].filter(Boolean).join(' ')
  return (
    <svg className={classes} viewBox="0 0 40 40" role="img" aria-label={String(value)}>
      <rect x="2" y="2" width="36" height="36" rx="8" />
      {PIPS[value]?.map(([x, y]) => (
        <circle key={`${x}${y}`} cx={11 + x * 9} cy={11 + y * 9} r="3.4" />
      ))}
    </svg>
  )
}
