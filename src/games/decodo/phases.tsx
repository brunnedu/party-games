// A round: writing clues, guessing a code, and the reveal.
import { useEffect, useState, type FormEvent } from 'react'
import type { Player } from '../../core/room/api'
import { useConfirm } from '../../core/ui/ConfirmDialog'
import { Waiting } from '../../core/ui/Waiting'
import { otherTeam, TEAMS, type ClueSet, type Snapshot, type StepActions, type Team } from './api'
import { teamClass, teamName } from './Parts'
import { s } from './strings.de'
import {
  encryptorOf, isRevealed, mayGuess, submittedBy, teamGuesses, teamOf,
} from './table'

export interface PhaseProps {
  snapshot: Snapshot
  players: Player[]
  userId: string
  nameOf: (id: string) => string
  isHost: boolean
  actions: StepActions
  busy: boolean
  run: (action: () => Promise<unknown>) => void
}

/** Counts down from the seconds the database reports. */
function Timer({ left }: { left: number }) {
  const [now, setNow] = useState(() => performance.now())
  const [end, setEnd] = useState(() => performance.now() + left * 1000)
  useEffect(() => setEnd(performance.now() + left * 1000), [left])
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((end - now) / 1000))
  return (
    <p className={seconds > 0 ? 'decodo-timer' : 'decodo-timer over'} role="timer">
      {seconds > 0 ? s.timeLeft(Math.min(seconds, 30)) : s.timeUp}
    </p>
  )
}

function ClueForm({ snapshot, userId, actions, busy, run }: PhaseProps) {
  const { code, words, pending } = snapshot
  // A new key (see below) resets this when there is a new code.
  const [clues, setClues] = useState(() => pending ?? ['', '', ''])
  const [hidden, setHidden] = useState(false)
  const team = teamOf(snapshot.game, userId)
  if (!code || !words || team === null) return null
  const complete = clues.every((c) => c.trim())
  const changed = !pending || clues.some((c, i) => c.trim() !== pending[i])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (complete && changed) run(() => actions.submit(clues))
  }

  return (
    <form className={`card stack secret ${teamClass(team)}`} onSubmit={submit}>
      <h2>{s.youEncrypt}</h2>
      <p className="muted center">
        {s.yourCode} · {s.secretHint}
      </p>
      <p className="decodo-code">{hidden ? '• • •' : code.join(' – ')}</p>
      <button type="button" className="link-button" onClick={() => setHidden(!hidden)}>
        {hidden ? s.showCode : s.hideCode}
      </button>
      {code.map((digit, i) => (
        <label key={i}>
          <span>
            {s.clueLabel(i + 1)}{' '}
            {!hidden && <span className="muted">{s.forWord(digit, words[digit - 1] ?? '')}</span>}
          </span>
          <input
            value={clues[i]}
            onChange={(e) => setClues(clues.map((c, j) => (j === i ? e.target.value : c)))}
            maxLength={60}
            autoComplete="off"
            enterKeyHint={i < 2 ? 'next' : 'done'}
          />
        </label>
      ))}
      <p className="muted">{s.clueHelp}</p>
      <button className="button" disabled={busy || !complete || !changed}>
        {pending ? s.change : s.submit}
      </button>
      {pending && !changed && <p className="center">{s.saved}</p>}
    </form>
  )
}

export function Writing(props: PhaseProps) {
  const { snapshot, userId, nameOf } = props
  const { game, history, code, timer_left } = snapshot
  const team = teamOf(game, userId)
  const writes =
    team !== null &&
    encryptorOf(game, team) === userId &&
    !isRevealed(game, history, team)

  return (
    <>
      {timer_left !== null && <Timer left={timer_left} />}
      {writes ? (
        <ClueForm key={code?.join('')} {...props} />
      ) : (
        <Waiting icon="✍️">{s.waitingForClues}</Waiting>
      )}
      <section className="card">
        <ul className="decodo-writers">
          {TEAMS.filter((id) => !isRevealed(game, history, id)).map((id) => (
            <li key={id} className={teamClass(id)}>
              <strong>{s.team(teamName(id))}</strong>
              <span>{s.encrypts(nameOf(encryptorOf(game, id)))}</span>
              <span className="tag">{submittedBy(game, id) ? s.done : s.writing}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

/** The clues of the code that is being guessed. */
const currentSet = ({ game, history }: Snapshot): ClueSet | undefined =>
  history.find((h) => h.round_no === game.round_no && h.team === game.turn)

function GuessForm({ snapshot, userId, actions, busy, run, set }: PhaseProps & { set: ClueSet }) {
  const { game, guess } = snapshot
  const digits = guess ?? [0, 0, 0]
  const complete = digits.every((d) => d > 0)
  // The question is outdated as soon as a teammate changes the guess.
  const confirm = useConfirm(`${game.step}:${digits.join('')}`)
  const own = teamOf(game, userId) === game.turn

  return (
    <section className="card stack">
      <p>{own ? s.decodeHelp : s.interceptHelp}</p>
      {set.clues.map((clue, i) => (
        <div key={i} className="decodo-guess-row">
          <span className="decodo-clue">{clue}</span>
          <div role="group" aria-label={clue}>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={s.digit(clue, n)}
                aria-pressed={digits[i] === n}
                disabled={busy}
                onClick={() => run(() => actions.pick(i + 1, digits[i] === n ? 0 : n))}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="muted">{s.sharedGuess}</p>
      <button
        className="button"
        disabled={busy || !complete}
        onClick={() =>
          confirm.ask(s.confirmLock(digits.join(' – ')), () => run(() => actions.lock(digits)))
        }
      >
        {complete ? s.lock : s.lockFirst}
      </button>
      {confirm.dialog}
    </section>
  )
}

export function Guessing(props: PhaseProps) {
  const { snapshot, userId, nameOf } = props
  const { game } = snapshot
  const set = currentSet(snapshot)
  const team = teamOf(game, userId)
  if (!set || team === null) return null
  const giver = encryptorOf(game, game.turn)
  const isGiver = giver === userId
  const locked = game.locked[team]

  return (
    <>
      <section className={`card center secret ${teamClass(game.turn)}`}>
        <h2>{s.codeOf(teamName(game.turn))}</h2>
        <p className="muted">{s.encrypts(nameOf(giver))}</p>
        {isGiver && <p>{s.readAloud}</p>}
      </section>
      {isGiver && <p className="decodo-note center">{s.keepQuiet}</p>}
      {mayGuess(game, userId) && !locked ? (
        <GuessForm {...props} set={set} />
      ) : (
        <section className="card stack">
          <ol className="decodo-clues">
            {set.clues.map((clue, i) => (
              <li key={i}>
                <span className="decodo-clue">{clue}</span>
              </li>
            ))}
          </ol>
          {locked && (
            <p className="center">
              {s.locked} {snapshot.guess && <strong>{snapshot.guess.join(' – ')}</strong>}
            </p>
          )}
          {!teamGuesses(game, team) && <p className="muted center">{s.noInterception}</p>}
        </section>
      )}
      <ul className="decodo-status" aria-live="polite">
        {TEAMS.filter((id) => teamGuesses(game, id)).map((id) => (
          <li key={id} className={teamClass(id)}>
            {game.locked[id] ? `✓ ${s.hasLocked(teamName(id))}` : s.isGuessing(teamName(id))}
          </li>
        ))}
      </ul>
    </>
  )
}

export function Reveal({ snapshot, userId, isHost, actions, busy, run }: PhaseProps) {
  const { game } = snapshot
  const set = currentSet(snapshot)
  if (!set?.code) return null
  const team = game.turn
  const other = otherTeam(team)
  const code = set.code
  const right = (guess: number[] | null) => guess?.join('') === code.join('')
  const row = (label: string, id: Team, guess: number[] | null) => (
    <li className={teamClass(id)}>
      <span>{label}</span>
      <strong>
        {guess ? guess.join(' – ') : s.noGuess} <span aria-hidden>{right(guess) ? '✓' : '✗'}</span>
      </strong>
    </li>
  )

  return (
    <>
      <section className={`card stack center secret ${teamClass(team)}`}>
        <h2>{s.codeOf(teamName(team))}</h2>
        <p className="muted">{s.correctCode}</p>
        <p className="decodo-code">{code.join(' – ')}</p>
        <ol className="decodo-clues">
          {set.clues.map((clue, i) => (
            <li key={i}>
              <span className="decodo-digit">{code[i]}</span>
              <span className="decodo-clue">{clue}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="card stack" aria-live="polite">
        <ul className="decodo-results">
          {row(s.decodeGuess(teamName(team)), team, set.own_guess)}
          {game.round_no > 1 && row(s.interceptGuess(teamName(other)), other, set.other_guess)}
        </ul>
        <p>
          <strong>
            {right(set.own_guess) ? s.understood(teamName(team)) : s.missed(teamName(team))}
          </strong>
        </p>
        {game.round_no > 1 && (
          <p>
            <strong>
              {right(set.other_guess)
                ? s.intercepted(teamName(other))
                : s.notIntercepted(teamName(other))}
            </strong>
          </p>
        )}
      </section>
      {isHost || encryptorOf(game, team) === userId ? (
        <button className="button" disabled={busy} onClick={() => run(actions.next)}>
          {s.next}
        </button>
      ) : (
        <p className="muted center">{s.waitingForNext}</p>
      )}
    </>
  )
}
