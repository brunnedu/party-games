// One component per phase of a round.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Player, Room } from '../../core/room/api'
import { errorText } from '../../core/rpc'
import { Avatar, avatarFor } from '../../core/ui/Avatar'
import { ErrorMessage } from '../../core/ui/components'
import { Confetti } from '../../core/ui/Confetti'
import { AvatarProgress, Waiting } from '../../core/ui/Waiting'
import type { Mode, RoundActions, Snapshot } from './api'
import { Dial } from './Dial'
import { Scale, SecretDial } from './Scale'
import { s } from './strings.de'
import { useLiveDial } from './useLiveDial'

export interface PhaseProps {
  snapshot: Snapshot
  room: Room
  players: Player[]
  userId: string
  nameOf: (id: string) => string
  playerOf: (id: string) => Player | undefined
  isHost: boolean
  actions: RoundActions
  busy: boolean
  run: (action: () => Promise<unknown>) => void
  /** Re-load everything. */
  reload: () => Promise<unknown>
}

export function CluePhase({ snapshot, userId, nameOf, actions, busy, run }: PhaseProps) {
  const { game, secret_target } = snapshot
  const [clue, setClue] = useState('')
  const [mode, setMode] = useState<Mode>(game.mode)
  const ends = { left: game.left_label, right: game.right_label }

  if (game.giver_id !== userId) {
    return (
      <>
        <Scale {...ends}>
          <Dial />
        </Scale>
        <Waiting>{s.waitingForClue(nameOf(game.giver_id))}</Waiting>
      </>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    run(() => actions.giveClue(mode, clue))
  }

  return (
    <>
      <SecretDial {...ends} target={secret_target} />
      <form className="card stack" onSubmit={submit}>
        <label>
          {s.yourClue}
          <input
            value={clue}
            onChange={(e) => setClue(e.target.value)}
            maxLength={40}
            placeholder={s.cluePlaceholder}
            autoComplete="off"
          />
        </label>
        <div className="stack">
          <strong id="mode-label">{s.modeLabel}</strong>
          <div className="tabs" role="group" aria-labelledby="mode-label">
            {(['shared', 'individual'] as const).map((m) => (
              <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {s.modes[m]}
              </button>
            ))}
          </div>
          <p className="muted">{s.modeHelp[mode]}</p>
        </div>
        <button className="button" disabled={busy}>
          {clue.trim() ? s.giveTyped : s.giveSpoken}
        </button>
      </form>
    </>
  )
}

function ClueCard({ clue }: { clue: string | null }) {
  return (
    <section className="card center secret">
      <p className="muted">{s.clue}</p>
      <p className={clue ? 'secret-word' : 'muted'}>{clue ?? s.spokenClue}</p>
    </section>
  )
}

export function Guessing(props: PhaseProps) {
  const { game } = props.snapshot
  const isGiver = game.giver_id === props.userId
  return (
    <>
      <ClueCard clue={game.clue} />
      {game.mode === 'shared' ? (
        <SharedGuess {...props} isGiver={isGiver} />
      ) : (
        <IndividualGuess {...props} isGiver={isGiver} />
      )}
    </>
  )
}

function Progress({
  snapshot: { game },
  players,
  playerOf,
  label,
}: PhaseProps & { label: (done: number, total: number) => string }) {
  const guessers = players.map((p) => p.user_id).filter((id) => id !== game.giver_id)
  return (
    <>
      <AvatarProgress ids={guessers} doneIds={game.done_ids} playerOf={playerOf} />
      <p className="muted center" aria-live="polite">
        {label(game.done_ids.length, guessers.length)}
      </p>
    </>
  )
}

function SharedGuess(props: PhaseProps & { isGiver: boolean }) {
  const { snapshot, room, userId, actions, busy, run, reload, isGiver } = props
  const { game, secret_target } = snapshot
  const ends = { left: game.left_label, right: game.right_label }
  const live = useLiveDial(room.id, game.round_no, game.dial)

  // The position this player is holding, or has let go of but isn't saved yet.
  const [own, setOwn] = useState<number | null>(null)
  const [saving, setSaving] = useState(0)
  const [moveError, setMoveError] = useState('')
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const position = own ?? live.preview ?? game.dial

  // Moves are saved one after another, so none gets lost or overtaken.
  function commit(next: number) {
    setSaving((n) => n + 1)
    queue.current = queue.current.then(async () => {
      try {
        await actions.moveDial(next)
        setMoveError('')
        await reload()
      } catch (e) {
        if ((e as { message?: string }).message !== 'wrong_phase') setMoveError(errorText(e))
      } finally {
        setSaving((n) => n - 1)
      }
    })
  }

  // Once everything is saved, follow the shared position again.
  const dragging = useRef(false)
  useEffect(() => {
    if (saving === 0 && !dragging.current) setOwn(null)
  }, [saving])

  const confirmed = game.done_ids.includes(userId)

  return (
    <>
      {isGiver ? (
        <SecretDial {...ends} target={secret_target} value={position} />
      ) : (
        <Scale {...ends}>
          <Dial
            value={position}
            onChange={(next) => {
              dragging.current = true
              setOwn(next)
              live.send(next)
            }}
            onCommit={(next) => {
              dragging.current = false
              commit(next)
            }}
          />
        </Scale>
      )}
      <p className="muted center">{isGiver ? s.giverWaits : s.sharedHelp}</p>
      {!isGiver && (
        <button
          className="button"
          // Not while the needle on screen differs from the saved position.
          disabled={busy || confirmed || saving > 0 || position !== game.dial}
          onClick={() => run(() => actions.confirm(game.dial))}
        >
          {confirmed ? s.confirmed : s.confirm}
        </button>
      )}
      <ErrorMessage>{moveError}</ErrorMessage>
      <Progress {...props} label={s.confirmedCount} />
    </>
  )
}

function IndividualGuess(props: PhaseProps & { isGiver: boolean }) {
  const { snapshot, userId, actions, busy, run, isGiver } = props
  const { game, secret_target, guesses } = snapshot
  const ends = { left: game.left_label, right: game.right_label }
  const saved = guesses.find((g) => g.player_id === userId)?.position
  const [own, setOwn] = useState(saved ?? 50)
  const changed = saved !== own

  if (isGiver) {
    return (
      <>
        <SecretDial {...ends} target={secret_target} />
        <p className="muted center">{s.giverWaits}</p>
        <Progress {...props} label={s.submittedCount} />
      </>
    )
  }

  return (
    <>
      <Scale {...ends}>
        <Dial value={own} onChange={setOwn} />
      </Scale>
      <p className="muted center">{s.individualHelp}</p>
      <button
        className="button"
        disabled={busy || !changed}
        onClick={() => run(() => actions.submitGuess(own))}
      >
        {saved === undefined ? s.submit : changed ? s.change : s.submitted}
      </button>
      <Progress {...props} label={s.submittedCount} />
    </>
  )
}

export function Reveal({
  snapshot,
  room,
  userId,
  nameOf,
  playerOf,
  isHost,
  actions,
  busy,
  run,
}: PhaseProps) {
  const { game, guesses } = snapshot
  const points = Number(game.round_points)
  const individual = game.mode === 'individual'
  const isFinal = game.rounds_played >= game.rounds_total
  const markers = guesses.map((g) => {
    const { icon, color } = avatarFor(playerOf(g.player_id))
    return { id: g.player_id, position: g.position, icon, color: color ?? '#e3d4b1' }
  })

  return (
    <>
      {points >= 3 && <Confetti />}
      <ClueCard clue={game.clue} />
      <Scale left={game.left_label} right={game.right_label}>
        <Dial
          target={game.target}
          reveal
          value={individual ? undefined : game.dial}
          markers={individual ? markers : []}
        />
      </Scale>
      <section className={`card center result ${points >= 2 ? 'correct' : 'wrong'}`}>
        <p className="result-headline">{s.verdict(points)}</p>
        <p>
          <strong>{s.roundPoints(points)}</strong>
        </p>
        {individual && <p className="muted">{s.averageNote}</p>}
      </section>
      {individual && (
        <section className="card">
          <ul className="player-list">
            {[...guesses]
              .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
              .map((g) => (
                <li key={g.player_id}>
                  <Avatar player={playerOf(g.player_id)} small />
                  <span className="player-name">{nameOf(g.player_id)}</span>
                  <span className="guess-points">{s.guessPoints(g.points ?? 0)}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
      {!isFinal && <p className="banner center">{s.joinNow(room.code)}</p>}
      {isHost || game.giver_id === userId ? (
        <button className="button" disabled={busy} onClick={() => run(actions.nextRound)}>
          {isFinal ? s.finish : s.nextRound}
        </button>
      ) : (
        <p className="muted center">{s.waitingForNext}</p>
      )}
    </>
  )
}
