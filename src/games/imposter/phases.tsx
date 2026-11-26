// One component per phase of a round.
import { useState } from 'react'
import type { Player, Room } from '../../core/room/api'
import { Avatar } from '../../core/ui/Avatar'
import { Confetti } from '../../core/ui/Confetti'
import { AvatarProgress, Waiting } from '../../core/ui/Waiting'
import type { RoundActions, Snapshot, Vote } from './api'
import { SecretArea } from './RoleCard'
import { Scoreboard } from './Scoreboard'
import { s } from './strings.de'
import { WordGrid } from './WordGrid'

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
}

export function Hints({ snapshot, userId, nameOf, playerOf, isHost, ...props }: PhaseProps) {
  const { actions, busy, run } = props
  return (
    <>
      <SecretArea snapshot={snapshot} />
      <section className="card stack">
        <h2>{s.hintsTitle}</h2>
        <p className="muted">{s.hintsHelp}</p>
        <ol className="speaking-order">
          {snapshot.game.player_ids.map((id, i) => (
            <li key={id} className={id === userId ? 'me' : undefined}>
              <span className="muted">{i + 1}.</span>
              <Avatar player={playerOf(id)} small />
              <span className="player-name">{nameOf(id)}</span>
              {i === 0 && <span className="tag">{s.starts}</span>}
            </li>
          ))}
        </ol>
      </section>
      {isHost ? (
        <button className="button" disabled={busy} onClick={() => run(actions.openVoting)}>
          {s.openVoting}
        </button>
      ) : (
        <p className="muted center">{s.waitingForVoting}</p>
      )}
    </>
  )
}

function VoteList({
  votes,
  nameOf,
  playerOf,
}: { votes: Vote[] } & Pick<PhaseProps, 'nameOf' | 'playerOf'>) {
  return (
    <ul className="player-list">
      {votes.map((v) => (
        <li key={`${v.vote_no}:${v.voter_id}`}>
          <Avatar player={playerOf(v.voter_id)} small />
          <span>{s.votedLine(nameOf(v.voter_id), nameOf(v.target_id))}</span>
        </li>
      ))}
    </ul>
  )
}

export function Voting({ snapshot, userId, nameOf, playerOf, ...props }: PhaseProps) {
  const { actions, busy, run } = props
  const { game, votes } = snapshot
  const runoff = game.vote_no > 1
  const own = votes.find((v) => v.vote_no === game.vote_no && v.voter_id === userId)
  const [selected, setSelected] = useState(own?.target_id)
  const participates = game.player_ids.includes(userId)
  const options = game.player_ids.filter(
    (id) =>
      id !== userId &&
      (game.candidate_ids.length === 0 || game.candidate_ids.includes(id)),
  )
  const changed = selected !== undefined && selected !== own?.target_id

  return (
    <>
      <SecretArea snapshot={snapshot} />
      <section className="card stack">
        <h2>{runoff ? s.runoffTitle : s.voteTitle}</h2>
        {runoff && <p className="muted">{s.runoffHelp}</p>}
        {participates && (
          <>
            <ul className="vote-options">
              {options.map((id) => (
                <li key={id}>
                  <button
                    className="vote-option"
                    aria-pressed={selected === id}
                    onClick={() => setSelected(id)}
                  >
                    <Avatar player={playerOf(id)} />
                    <span className="player-name">{nameOf(id)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {own && <p className="center">{s.votedFor(nameOf(own.target_id))}</p>}
            <button
              className="button"
              disabled={busy || !changed || !options.includes(selected)}
              onClick={() => run(() => actions.vote(game.vote_no, selected!))}
            >
              {own ? s.changeVote : s.vote}
            </button>
          </>
        )}
      </section>
      <AvatarProgress ids={game.player_ids} doneIds={game.voted_ids} playerOf={playerOf} />
      <p className="muted center" aria-live="polite">
        {s.votesIn(game.voted_ids.length, game.player_ids.length)}
      </p>
      {runoff && (
        <section className="card">
          <h2>{s.firstVote}</h2>
          <VoteList
            votes={votes.filter((v) => v.vote_no === 1)}
            nameOf={nameOf}
            playerOf={playerOf}
          />
        </section>
      )}
    </>
  )
}

export function Guessing({ snapshot, userId, nameOf, playerOf, ...props }: PhaseProps) {
  const { actions, busy, run } = props
  const { game } = snapshot
  const [selected, setSelected] = useState<string>()
  const isImposter = game.imposter_id === userId
  const imposter = game.imposter_id ?? ''

  return (
    <>
      <section className="card center secret">
        <Avatar player={playerOf(imposter)} />
        <p className="result-headline">{s.caught(nameOf(imposter))}</p>
        <p className="muted">{isImposter ? s.lastChance : s.waitingForGuess(nameOf(imposter))}</p>
      </section>
      {isImposter ? (
        <>
          <WordGrid game={game} selected={selected} onSelect={setSelected} />
          <button
            className="button"
            disabled={busy || !selected}
            onClick={() => run(() => actions.guess(selected!))}
          >
            {s.confirmGuess(selected ?? '…')}
          </button>
        </>
      ) : (
        // The word stays hidden here too: the imposter may be sitting close.
        <SecretArea snapshot={snapshot} />
      )}
    </>
  )
}

export function RoundResult({
  snapshot,
  room,
  players,
  userId,
  nameOf,
  playerOf,
  isHost,
  actions,
  busy,
  run,
}: PhaseProps) {
  const { game, votes, scores } = snapshot
  const outcome = game.outcome ?? 'cancelled'
  const imposter = game.imposter_id ?? ''
  const isImposter = imposter === userId
  const played = game.player_ids.includes(userId)
  // Did things go well for the person looking at this screen?
  const imposterScored = outcome === 'escaped' || outcome === 'caught_guessed'
  const iScored = outcome !== 'cancelled' && played && isImposter === imposterScored
  const tone = !played || outcome === 'cancelled' ? '' : iScored ? 'correct' : 'wrong'
  const finalVotes = votes.filter((v) => v.vote_no === Math.max(...votes.map((x) => x.vote_no)))

  return (
    <>
      {iScored && <Confetti />}
      <section className={`card center result ${tone}`}>
        <Avatar player={playerOf(imposter)} />
        <p className="result-headline">{s.outcome[outcome]}</p>
        <p>
          <strong>{s.wasImposter(nameOf(imposter))}</strong>
        </p>
        {game.accused_id && game.accused_id !== imposter && (
          <p>{s.accused(nameOf(game.accused_id))}</p>
        )}
        {game.guess && <p>{s.guessWas(game.guess)}</p>}
        <p className="muted">{s.points[outcome](nameOf(imposter))}</p>
        {!played && <p className="muted">{s.watching}</p>}
      </section>
      <WordGrid
        game={game}
        highlight={game.word}
        wrong={game.guess !== game.word ? game.guess : null}
      />
      <section className="card">
        <h2>{s.scores}</h2>
        <Scoreboard players={players} scores={scores} userId={userId} />
      </section>
      {finalVotes.length > 0 && (
        <details className="card">
          <summary>{s.votes}</summary>
          <VoteList votes={finalVotes} nameOf={nameOf} playerOf={playerOf} />
        </details>
      )}
      <p className="banner center">{s.joinNow(room.code)}</p>
      {isHost ? (
        <>
          <button className="button" disabled={busy} onClick={() => run(actions.nextRound)}>
            {s.nextRound}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm(s.confirmEndGame)) run(actions.endGame)
            }}
          >
            {s.endGame}
          </button>
        </>
      ) : (
        <Waiting icon="⏳">{s.waitingForNext}</Waiting>
      )}
    </>
  )
}
