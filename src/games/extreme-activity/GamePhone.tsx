// The screens of the phone that is passed around.
import { useEffect, useRef, useState } from 'react'
import { ErrorMessage } from '../../core/ui/components'
import type { TimedSnapshot, TurnActions } from './api'
import { alarm, unlockSound, useCountdown } from './device'
import { clockText, teamTotal } from './scoring'
import { s } from './strings.de'

export interface PhoneProps {
  snapshot: TimedSnapshot
  actions: TurnActions
  busy: boolean
  error: string
  run: (action: () => Promise<unknown>) => void
  /** Re-load the game without showing errors or blocking buttons. */
  reload: () => Promise<void>
}

export function ModeInfo({ mode }: { mode: number }) {
  const info = s.modes[mode - 1]
  if (!info) return null
  return (
    <div className="mode-info">
      <span className="muted">{s.phaseOf(mode)}</span>
      <h2>{info.name}</h2>
      <p>{info.rule}</p>
      <p className="muted">{s.unlimited}</p>
    </div>
  )
}

/** Between two turns. Nothing about any word is on this screen. */
function Ready({ snapshot, actions, busy, run }: PhoneProps) {
  const { game, points } = snapshot
  return (
    <>
      <section className={`card center team-card team-${game.team}`}>
        <p>{game.turn_no === 1 ? s.passFirst : s.passNext}</p>
        <p className="secret-word">{s.teams[game.team]}</p>
        <p>{s.score(teamTotal(points, 0), teamTotal(points, 1))}</p>
      </section>
      <section className="card center">
        <ModeInfo mode={game.mode} />
        <strong>{s.inBucket(snapshot.words_left)}</strong>
        <button
          className="button big-button"
          disabled={busy}
          onClick={() => {
            unlockSound()
            run(actions.begin)
          }}
        >
          {s.start}
        </button>
      </section>
    </>
  )
}

/** Full screen while the clock runs, so nothing else can be tapped. */
function Playing({ snapshot, actions, busy, error, run, reload }: PhoneProps) {
  const { game, word } = snapshot
  const left = useCountdown(snapshot.deadline, true, 0)
  const expired = left === 0

  const latest = useRef({ actions, reload })
  latest.current = { actions, reload }
  const alarmed = useRef(false)
  useEffect(() => {
    if (!expired) return
    if (!alarmed.current) alarm()
    alarmed.current = true
    // Repeats until it got through; this screen disappears then.
    const send = () => {
      const { actions, reload } = latest.current
      void actions
        .timeUp()
        .catch(() => {})
        .then(reload)
    }
    send()
    const timer = setInterval(send, 1500)
    return () => clearInterval(timer)
  }, [expired])

  // A new word ignores taps for a moment, so a double tap can't skip past it.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    setSettled(false)
    const timer = setTimeout(() => setSettled(true), 500)
    return () => clearTimeout(timer)
  }, [word?.id])

  return (
    <div className={`turn-screen team-${game.team}`}>
      <div className="turn-top">
        <span className="team-tag">{s.teams[game.team]}</span>
        <strong className="clock" role="timer">
          {clockText(left)}
        </strong>
        <button
          className="button secondary pause-button"
          disabled={busy || expired}
          onClick={() => run(actions.pause)}
        >
          {s.pause}
        </button>
      </div>
      <div className="time-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, left / 600)}%` }} />
      </div>
      <p className="muted center">
        {s.modes[game.mode - 1]?.name} · {s.inBucket(snapshot.words_left)}
      </p>
      <div className="card turn-word">
        <p className="secret-word">{expired ? s.timeUp : word?.text}</p>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      <button
        className="button guess-button"
        disabled={busy || expired || !word}
        aria-disabled={!settled}
        onClick={() => {
          if (settled && word) run(() => actions.guessed(word.id))
        }}
      >
        {s.guessed} · {snapshot.turn_points}
      </button>
    </div>
  )
}

/** A pause, or the break before the next mode. The word stays hidden. */
function Break({ snapshot, actions, busy, run }: PhoneProps) {
  const { game } = snapshot
  const newMode = game.phase === 'new_mode'
  return (
    <section className={`card center team-edge team-${game.team}`}>
      <p className="result-headline">{newMode ? s.modeDone : s.paused}</p>
      {newMode && <p>{s.nextMode}</p>}
      <ModeInfo mode={game.mode} />
      {newMode && <p>{s.allBack}</p>}
      <p className="final-score">{clockText(game.time_left_ms)}</p>
      <p className="muted">{s.teams[game.team]}</p>
      <button
        className="button big-button"
        disabled={busy}
        onClick={() => {
          unlockSound()
          run(actions.resume)
        }}
      >
        {s.resume}
      </button>
      {newMode && (
        <button className="link-button" disabled={busy} onClick={() => run(actions.undoMode)}>
          {s.undoLast}
        </button>
      )}
    </section>
  )
}

function Summary({ snapshot, actions, busy, run }: PhoneProps) {
  const { game, summary, turn_points } = snapshot
  const over = game.mode > 5
  return (
    <section className={`card center team-edge team-${game.team}`}>
      <p className="result-headline">{over ? s.allDone : s.timeUp}</p>
      <p className="muted">{s.summaryHelp}</p>
      <ul className="turn-list">
        {summary?.map((row) => (
          <li key={row.id}>
            <button
              aria-pressed={row.counted}
              disabled={busy || row.mode !== game.played_mode}
              onClick={() => run(() => actions.setCounted(row.id, !row.counted))}
            >
              <span className="turn-list-word">{row.text}</span>
              <span className="muted">
                {row.mode !== game.played_mode && `${s.modes[row.mode - 1]?.name} · `}
                {row.counted ? `✓ ${s.counted}` : s.notCounted}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="result-headline">{s.turnPoints(turn_points, s.teams[game.team])}</p>
      {!over && game.mode !== game.played_mode && (
        <p>{s.continuesWith(s.modes[game.mode - 1]?.name ?? '')}</p>
      )}
      <button className="button big-button" disabled={busy} onClick={() => run(actions.passOn)}>
        {over ? s.toResult : s.passOn}
      </button>
    </section>
  )
}

export function GamePhone(props: PhoneProps) {
  switch (props.snapshot.game.phase) {
    case 'ready':
      return <Ready {...props} />
    case 'playing':
      return <Playing {...props} />
    case 'paused':
    case 'new_mode':
      return <Break {...props} />
    case 'summary':
      return <Summary {...props} />
    default:
      return null
  }
}
