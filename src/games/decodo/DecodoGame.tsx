import type { ComponentType } from 'react'
import type { GameViewProps } from '../../core/game'
import { roomApi } from '../../core/room/api'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { useConfirm } from '../../core/ui/ConfirmDialog'
import { PlayerList } from '../../core/ui/PlayerList'
import { useAction } from '../../core/ui/useAction'
import { decodoApi, stepActions, TEAMS, type Phase } from './api'
import { GameOver, Judging, Tiebreak } from './Ending'
import { NoteSheet, SecretWords, teamName, Tokens } from './Parts'
import { Guessing, Reveal, Writing, type PhaseProps } from './phases'
import { s } from './strings.de'
import { encryptorOf, idsOf, isRevealed, teamGuesses, teamOf } from './table'
import '../../core/ui/game.css'
import './decodo.css'

const PHASES: Record<Exclude<Phase, 'game_over'>, ComponentType<PhaseProps>> = {
  writing: Writing,
  guessing: Guessing,
  reveal: Reveal,
  tiebreak: Tiebreak,
  judging: Judging,
}

export function DecodoGame({ room, players, userId, online, refresh }: GameViewProps) {
  // Every change bumps room.version, which re-loads the game.
  const query = useQuery(() => decodoApi.snapshot(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const snapshot = query.data
  // Kicking and aborting stay valid across rounds, but not past the end.
  const hostConfirm = useConfirm(String(snapshot?.game.phase === 'game_over'))

  if (!snapshot) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }

  const { game, history, words } = snapshot
  const isHost = room.host_id === userId
  const team = teamOf(game, userId)
  const nameOf = (id: string) =>
    players.find((p) => p.user_id === id)?.name ?? s.unknownPlayer
  const actions = stepActions(room.id, game.step)
  const over = game.phase === 'game_over'
  const inRound = ['writing', 'guessing', 'reveal'].includes(game.phase)
  const offline = (id: string) => id !== userId && online !== null && !online.has(id)
  const shared = {
    snapshot,
    players,
    userId,
    nameOf,
    isHost,
    actions,
    busy,
    run: (action: () => Promise<unknown>) => void run(action),
  }

  // Host help for people who are offline.
  const goneGivers = inRound
    ? TEAMS.filter((id) => offline(encryptorOf(game, id)) && !isRevealed(game, history, id))
    : []
  const goneGuessers =
    game.phase === 'guessing'
      ? TEAMS.filter(
          (id) =>
            teamGuesses(game, id) &&
            !game.locked[id] &&
            idsOf(game, id)
              .filter((p) => !(id === game.turn && p === encryptorOf(game, id)))
              .every(offline),
        )
      : []

  let content
  if (game.phase === 'game_over') {
    content = <GameOver {...shared} room={room} />
  } else {
    const PhaseView = PHASES[game.phase]
    // A new key per screen resets inputs.
    content = <PhaseView key={game.step} {...shared} />
  }

  return (
    <>
      {!over && (
        <>
          <div className="status-bar">
            <span>{s.round(game.round_no)}</span>
            {team !== null && <strong>{s.yourTeam(teamName(team))}</strong>}
          </div>
          <Tokens game={game} own={team} />
          {inRound && words && team !== null && <SecretWords words={words} team={team} />}
        </>
      )}
      {content}
      <ErrorMessage>{error}</ErrorMessage>
      {inRound && history.some((h) => h.code) && (
        // Starts with the team whose clues are being guessed.
        <NoteSheet key={game.turn} history={history} initial={game.turn} />
      )}

      <details className="card">
        <summary>{t.playersInRoom(players.length)}</summary>
        <PlayerList
          room={room}
          players={players}
          userId={userId}
          online={online}
          onKick={
            isHost
              ? (p) =>
                  hostConfirm.ask(t.confirmKick(p.name), () =>
                    void run(() => roomApi.kick(room.id, p.user_id)),
                  )
              : undefined
          }
        />
      </details>

      {isHost && !over && (
        <details className="card">
          <summary>{s.hostTools}</summary>
          <div className="stack">
            {goneGivers.map((id) => (
              <button
                key={id}
                className="button secondary"
                disabled={busy}
                onClick={() => void run(() => actions.replaceEncryptor(id))}
              >
                {s.replace(nameOf(encryptorOf(game, id)))}
              </button>
            ))}
            {goneGuessers.map((id) => (
              <button
                key={id}
                className="button secondary"
                disabled={busy}
                onClick={() => void run(() => actions.skipGuess(id))}
              >
                {s.skipGuess(teamName(id))}
              </button>
            ))}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                hostConfirm.ask(s.confirmAbort, () =>
                  void run(() => roomApi.returnToLobby(room.id)),
                )
              }
            >
              {s.abort}
            </button>
          </div>
        </details>
      )}
      {hostConfirm.dialog}
    </>
  )
}
