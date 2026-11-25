const COLORS = ['#b0432b', '#3d6b3a', '#e8b83e', '#4f86a8', '#d9798f']
const PIECES = 48

/** A short burst of paper snippets. Hidden when the device asks for less motion. */
export function Confetti() {
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: PIECES }, (_, i) => (
        <i
          key={i}
          style={{
            // Spread pieces evenly but irregularly; no randomness needed.
            left: `${(i * 37) % 100}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${((i * 13) % 20) / 40}s`,
            animationDuration: `${1.8 + ((i * 7) % 10) / 10}s`,
          }}
        />
      ))}
    </div>
  )
}
