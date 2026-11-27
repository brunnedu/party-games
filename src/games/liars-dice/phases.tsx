// One component per phase of a round.
import { useState } from 'react'
import type { Player } from '../../core/room/api'
import { Avatar } from '../../core/ui/Avatar'
import { useConfirm } from '../../core/ui/ConfirmDialog'
import { Waiting } from '../../core/ui/Waiting'
import type { RoundActions, Snapshot, Verdict } from './api'
import { DiceFace } from './DiceFace'
import { OwnDice } from './OwnDice'
import { s } from './strings.de'
import { countFaces, diceOf, previousPlayer } from './table'

export interface PhaseProps {
  snapshot: Snapshot
  userId: string
  nameOf: (id: string) => string
  playerOf: (id: string) => Player | undefined
  isHost: boolean
  actions: RoundActions
  busy: boolean
  run: (action: () => Promise<unknown>) => void
}

const ROLL_MS = 900

export function Rolling({ snapshot, userId, nameOf, actions, busy, run }: PhaseProps) {
  const { game, own_dice } = snapshot
  const [shaking, setShaking] = useState(false)
  const playing = diceOf(game, userId) > 0
  const rolled = game.rolled_ids.includes(userId)
  const missing = game.order_ids.filter(
    (id) => diceOf(game, id) > 0 && !game.rolled_ids.includes(id),
  )

  function roll() {
    setShaking(true)
    run(async () => {
      // Let the cup shake for a moment, however fast the server answers.
      const pause = new Promise((resolve) => setTimeout(resolve, ROLL_MS))
      try {
        await Promise.all([actions.roll(), pause])
      } finally {
        setShaking(false)
      }
    })
  }

  return (
    <>
      {!playing && <Waiting icon="👀">{s.spectating}</Waiting>}
      {playing && (shaking || !rolled) && (
        <section className="card center">
          <div className={shaking ? 'cup shaking' : 'cup'} aria-hidden>
            <DiceFace value={5} />
            <DiceFace value={3} />
            <DiceFace value={6} />
          </div>
          <button className="button" disabled={busy || shaking} onClick={roll}>
            {shaking ? s.rolling : s.roll}
          </button>
        </section>
      )}
      {playing && rolled && !shaking && own_dice && <OwnDice dice={own_dice} />}
      {missing.length > 0 && (
        <p className="muted center" aria-live="polite">
          {s.waitingForRolls(missing.map(nameOf).join(', '))}
        </p>
      )}
    </>
  )
}

export function Bidding({ snapshot, userId, nameOf, actions, busy, run }: PhaseProps) {
  const { game, own_dice } = snapshot
  const playing = diceOf(game, userId) > 0
  const previous = playing ? previousPlayer(game, userId) : undefined
  const confirm = useConfirm()

  function doubt() {
    if (previous) confirm.ask(s.confirmDoubt(nameOf(previous)), () => run(actions.doubt))
  }

  return (
    <>
      <p className="role highlight">
        {game.starter_id === userId ? s.youStart : s.starts(nameOf(game.starter_id))}
      </p>
      {playing && own_dice ? (
        <OwnDice dice={own_dice} />
      ) : (
        <Waiting icon="👀">{s.spectating}</Waiting>
      )}
      <p className="muted center">{s.bidHelp}</p>
      {playing && (
        <>
          <button className="button doubt-button" disabled={busy} onClick={doubt}>
            {s.doubt}
          </button>
          <p className="muted center">{s.doubtHelp}</p>
        </>
      )}
      {confirm.dialog}
    </>
  )
}

export function Revealed({
  snapshot,
  userId,
  nameOf,
  playerOf,
  isHost,
  actions,
  busy,
  run,
}: PhaseProps) {
  const { game } = snapshot
  const [face, setFace] = useState<number>()
  const revealed = game.revealed ?? {}
  const counts = countFaces(revealed)
  const doubter = game.doubter_id ?? ''
  const accused = game.accused_id ?? ''
  const isDoubter = doubter === userId
  const judge = isDoubter || isHost
  const loser = game.verdict === 'doubter_loses' ? doubter : accused
  const survivors = game.order_ids.filter((id) => diceOf(game, id) > 0)
  const isFinal =
    game.verdict !== null && survivors.length === 2 && diceOf(game, loser) === 1

  const choices: [Verdict, string][] = [
    ['doubter_loses', isDoubter ? s.doubterLoses : s.doubterLosesNamed(nameOf(doubter))],
    ['accused_loses', s.accusedLoses(nameOf(accused))],
  ]

  return (
    <>
      <p className="role highlight">{s.doubts(nameOf(doubter), nameOf(accused))}</p>
      <section className="card stack">
        <h2>{s.summary}</h2>
        <div className="face-summary">
          {counts.map((count, i) => (
            <button
              key={i}
              aria-pressed={face === i + 1}
              aria-label={s.faceCount(i + 1, count)}
              onClick={() => setFace(face === i + 1 ? undefined : i + 1)}
            >
              <DiceFace value={i + 1} />
              <strong>{count}×</strong>
            </button>
          ))}
        </div>
        <p className="muted">{s.summaryHelp}</p>
        <ul className="player-list">
          {game.order_ids
            .filter((id) => revealed[id])
            .map((id) => (
              <li key={id} className="revealed-row">
                <Avatar player={playerOf(id)} small />
                <span className="player-name">{nameOf(id)}</span>
                <span className="revealed-dice">
                  {revealed[id]!.map((value, i) => (
                    <DiceFace
                      key={i}
                      value={value}
                      highlight={face === value}
                      dim={face !== undefined && face !== value}
                    />
                  ))}
                </span>
              </li>
            ))}
        </ul>
      </section>

      <section className="card stack">
        {game.verdict ? (
          <p className="result-headline center" aria-live="polite">
            {s.verdictShown(nameOf(loser))}
          </p>
        ) : (
          !judge && <p className="muted center">{s.verdictPending(nameOf(doubter))}</p>
        )}
        {judge && (
          <>
            <h2>{s.verdictTitle}</h2>
            {choices.map(([verdict, label]) => (
              <button
                key={verdict}
                className="verdict-button"
                aria-pressed={game.verdict === verdict}
                disabled={busy}
                onClick={() => run(() => actions.setVerdict(verdict))}
              >
                {label}
              </button>
            ))}
            {game.verdict && (
              <>
                <p className="muted">{s.verdictChangeHint}</p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => run(() => actions.nextRound(game.verdict!))}
                >
                  {isFinal ? s.finish : s.nextRound}
                </button>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}
