import type { ComponentType } from 'react'
import type { GameViewProps } from '../../core/game'
import { roomApi } from '../../core/room/api'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { Avatar } from '../../core/ui/Avatar'
import { ErrorMessage } from '../../core/ui/components'
import { PlayerList } from '../../core/ui/PlayerList'
import { useAction } from '../../core/ui/useAction'
import { justOneApi, roundActions, type Phase } from './api'
import { CardProgress } from './CardProgress'
import { cardSlots } from './cardSlots'
import { GameOver } from './GameOver'
import {
  ChoosingWord,
  Guessing,
  ReviewingClues,
  RoundResult,
  WritingClues,
  type PhaseProps,
} from './phases'
import { s } from './strings.de'
import './just-one.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  choosing_word: ChoosingWord,
  writing_clues: WritingClues,
  reviewing_clues: ReviewingClues,
  guessing: Guessing,
  round_result: RoundResult,
}

export function JustOneGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => justOneApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game } = snapshot
  const isHost = room.host_id === userId
  const isGuesser = game.guesser_id === userId
  const playerOf = (id: string) => players.find((p) => p.user_id === id)
  const nameOf = (id: string) => playerOf(id)?.name ?? s.unknownPlayer
  const actions = roundActions(room.id, game.round_no)
  const over = game.phase === 'game_over'

  const confirmThen = (question: string, action: () => Promise<unknown>) => () => {
    if (window.confirm(question)) void run(action)
  }

  let content
  if (game.phase === 'game_over') {
    content = (
      <>
        <GameOver snapshot={snapshot} />
        {isHost ? (
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(() => roomApi.returnToLobby(room.id))}
          >
            {s.playAgain}
          </button>
        ) : (
          <p className="muted center">{s.waitingForRematch}</p>
        )}
      </>
    )
  } else {
    const PhaseView = PHASES[game.phase]
    content = (
      // A new key per round and phase resets inputs.
      <PhaseView
        key={`${game.round_no}:${game.phase}`}
        snapshot={snapshot}
        userId={userId}
        playerIds={players.map((p) => p.user_id)}
        nameOf={nameOf}
        playerOf={playerOf}
        isGuesser={isGuesser}
        isHost={isHost}
        actions={actions}
        busy={busy}
        run={(action) => void run(action)}
      />
    )
  }

  return (
    <>
      {!over && (
        <div className="status-bar">
          <span>{s.card(game.cards_used + 1, game.cards_total)}</span>
          <strong>{s.score(game.score)}</strong>
          <CardProgress slots={cardSlots(game, snapshot.history)} />
          <div className={isGuesser ? 'role guesser' : 'role'}>
            <Avatar player={playerOf(game.guesser_id)} />
            {isGuesser ? s.youGuess : s.isGuessing(nameOf(game.guesser_id))}
          </div>
        </div>
      )}
      {content}
      <ErrorMessage>{error}</ErrorMessage>

      <details className="card">
        <summary>{t.playersInRoom(players.length)}</summary>
        <PlayerList
          room={room}
          players={players}
          userId={userId}
          online={online}
          onKick={
            isHost
              ? (p) => confirmThen(t.confirmKick(p.name), () => roomApi.kick(room.id, p.user_id))()
              : undefined
          }
        />
      </details>

      {isHost && !over && (
        <details className="card">
          <summary>{s.hostTools}</summary>
          <div className="stack">
            {(game.phase === 'writing_clues' || game.phase === 'reviewing_clues') && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(actions.forceContinue)}
              >
                {s.forceContinue}
              </button>
            )}
            {game.phase !== 'round_result' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={confirmThen(s.confirmSkipRound, actions.skipRound)}
              >
                {s.skipRound}
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={confirmThen(s.confirmAbort, () => roomApi.returnToLobby(room.id))}
            >
              {s.abort}
            </button>
          </div>
        </details>
      )}
    </>
  )
}
