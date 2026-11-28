// The tiebreak and the end of the game.
import { useState, type FormEvent } from 'react'
import { roomApi, type Room } from '../../core/room/api'
import { Confetti } from '../../core/ui/Confetti'
import { Waiting } from '../../core/ui/Waiting'
import { normalize } from '../dito/match'
import { otherTeam, TEAMS, type TiebreakRow } from './api'
import { NoteSheet, teamClass, teamName } from './Parts'
import type { PhaseProps } from './phases'
import { s } from './strings.de'
import { teamOf } from './table'

export function Tiebreak({ snapshot, userId, actions, busy, run }: PhaseProps) {
  const team = teamOf(snapshot.game, userId)
  // During the tiebreak, only the own team's guesses are readable.
  const saved = snapshot.tiebreak.find((row) => row.team === team)?.guesses
  const [words, setWords] = useState(() => saved ?? ['', '', '', ''])
  const complete = words.every((w) => w.trim())
  const changed = !saved || words.some((w, i) => w.trim() !== saved[i])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (complete && changed) run(() => actions.tiebreakGuess(words))
  }

  return (
    <form className="card stack secret" onSubmit={submit}>
      <h2>{s.tiebreakTitle}</h2>
      <p className="muted">{s.tiebreakHelp}</p>
      {words.map((word, i) => (
        <label key={i}>
          {s.guessLabel(i + 1)}
          <input
            value={word}
            onChange={(e) => setWords(words.map((w, j) => (j === i ? e.target.value : w)))}
            maxLength={40}
            autoComplete="off"
            enterKeyHint={i < 3 ? 'next' : 'done'}
          />
        </label>
      ))}
      <button className="button" disabled={busy || !complete || !changed}>
        {saved ? s.change : s.sendWords}
      </button>
      {saved && !changed && <p className="center">{s.wordsSent}</p>}
    </form>
  )
}

function JudgeForm({
  row,
  ownWords,
  actions,
  busy,
  run,
}: PhaseProps & { row: TiebreakRow; ownWords: string[] }) {
  // Identical words are ticked already; the team decides about the rest.
  const [marks, setMarks] = useState(() => {
    const own = ownWords.map(normalize)
    return row.guesses.map((g) => own.includes(normalize(g)))
  })
  return (
    <section className="card stack">
      <p className="muted">{s.judgeHelp}</p>
      <p>
        <strong>{s.yourWords}:</strong> {ownWords.join(', ')}
      </p>
      {row.guesses.map((guess, i) => (
        <label key={i} className="decodo-judge">
          <input
            type="checkbox"
            checked={marks[i]}
            onChange={(e) => setMarks(marks.map((m, j) => (j === i ? e.target.checked : m)))}
          />
          <span>{guess}</span>
        </label>
      ))}
      <button className="button" disabled={busy} onClick={() => run(() => actions.judge(marks))}>
        {s.judge}
      </button>
    </section>
  )
}

export function Judging(props: PhaseProps) {
  const { snapshot, userId } = props
  const team = teamOf(snapshot.game, userId)
  const words = snapshot.game.final_words
  if (team === null || !words) return null
  const theirs = snapshot.tiebreak.find((row) => row.team === otherTeam(team))

  return (
    <>
      <h2>{s.judgeTitle}</h2>
      {theirs && !theirs.marks ? (
        <JudgeForm {...props} row={theirs} ownWords={words[team]} />
      ) : (
        <Waiting icon="⚖️">{s.judged}</Waiting>
      )}
    </>
  )
}

export function GameOver({
  snapshot: { game, history, tiebreak },
  room,
  userId,
  busy,
  run,
}: PhaseProps & { room: Room }) {
  const outcome = game.outcome
  const team = teamOf(game, userId)
  if (!outcome) return null
  const headline =
    outcome.winner !== null
      ? s.wins(teamName(outcome.winner))
      : outcome.reason === 'left'
        ? s.noWinner
        : s.sharedWin
  const won = outcome.reason !== 'left' && (outcome.winner ?? team) === team

  return (
    <>
      {won && <Confetti />}
      <section className="card center secret">
        <h2>{s.gameOver}</h2>
        <p className="result-headline">{headline}</p>
        <p className="muted">{s.reasons[outcome.reason]}</p>
        {outcome.reason === 'words' &&
          TEAMS.map((id) => (
            <p key={id}>
              {s.hits(
                teamName(id),
                tiebreak.find((row) => row.team === id)?.marks?.filter(Boolean).length ?? 0,
              )}
            </p>
          ))}
      </section>
      {game.final_words &&
        TEAMS.map((id) => (
          <section key={id} className={`card ${teamClass(id)} decodo-final`}>
            <h2>{s.wordsOf(teamName(id))}</h2>
            <ol>
              {game.final_words![id].map((word) => (
                <li key={word}>{word}</li>
              ))}
            </ol>
          </section>
        ))}
      <NoteSheet history={history} initial={team ?? 0} words={game.final_words} />
      {room.host_id === userId ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => run(() => roomApi.returnToLobby(room.id))}
        >
          {s.playAgain}
        </button>
      ) : (
        <p className="muted center">{s.waitingForRematch}</p>
      )}
    </>
  )
}
