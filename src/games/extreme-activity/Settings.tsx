import type { Player } from '../../core/room/api'
import { s } from './strings.de'

/** Which phone is passed around. Only the host can change it. */
export function PhoneChoice({
  players,
  phoneId,
  disabled,
  onChange,
}: {
  players: Player[]
  phoneId: string
  disabled: boolean
  onChange: (phoneId: string) => void
}) {
  return (
    <label>
      {s.gamePhone}
      <select value={phoneId} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {players.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export function MaxWordsChoice({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <>
      <strong>{s.maxWords}</strong>
      <div className="number-choice" role="group" aria-label={s.maxWords}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button key={n} aria-pressed={value === n} disabled={disabled} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </>
  )
}
