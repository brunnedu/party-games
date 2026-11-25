// One component per phase of a round.
import { useState, type FormEvent, type ReactNode } from 'react'
import type { Clue, RoundActions, Snapshot } from './api'
import { s } from './strings.de'

export interface PhaseProps {
  snapshot: Snapshot
  userId: string
  playerIds: string[]
  nameOf: (id: string) => string
  isGuesser: boolean
  isHost: boolean
  actions: RoundActions
  busy: boolean
  run: (action: () => Promise<unknown>) => void
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <section className="card center">
      <p className="muted">{children}</p>
    </section>
  )
}

function SecretWord({ word }: { word: string }) {
  return (
    <section className="card center">
      <p className="muted">{s.theWord}</p>
      <p className="secret-word">{word}</p>
    </section>
  )
}

function ClueList({ clues, nameOf }: { clues: Clue[]; nameOf: PhaseProps['nameOf'] }) {
  if (clues.length === 0) return <p className="muted center">{s.noClues}</p>
  return (
    <ul className="clue-list">
      {clues.map((c) => (
        <li key={c.player_id} className={isCancelled(c) ? 'clue cancelled' : 'clue'}>
          <span className="clue-text">{c.clue}</span>
          <span className="muted">
            {nameOf(c.player_id)}
            {isCancelled(c) &&
              ` · ${c.auto_cancelled ? s.autoCancelled : s.manualCancelled}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

const isCancelled = (c: Clue) => c.auto_cancelled || c.manual_cancelled

export function ChoosingWord({ snapshot, isGuesser, actions, busy, run }: PhaseProps) {
  const { word } = snapshot
  if (isGuesser || !word) return <Waiting>{s.guesserWaitsWord}</Waiting>
  return (
    <>
      <SecretWord word={word} />
      <p className="muted center">{s.chooseHint}</p>
      <button className="button" disabled={busy} onClick={() => run(actions.acceptWord)}>
        {s.acceptWord}
      </button>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => run(() => actions.skipWord(word))}
      >
        {s.skipWord}
      </button>
    </>
  )
}

function Progress({ snapshot, userId, playerIds, nameOf }: PhaseProps) {
  const { guesser_id, submitted_ids } = snapshot.game
  const givers = playerIds.filter((id) => id !== guesser_id)
  const missing = givers.filter((id) => !submitted_ids.includes(id) && id !== userId)
  return (
    <p className="muted center">
      {s.progress(submitted_ids.length, givers.length)}
      {missing.length > 0 && (
        <>
          <br />
          {s.waitingFor(missing.map(nameOf).join(', '))}
        </>
      )}
    </p>
  )
}

export function WritingClues(props: PhaseProps) {
  const { snapshot, userId, isGuesser, actions, busy, run } = props
  const own = snapshot.clues.find((c) => c.player_id === userId)
  const [text, setText] = useState('')

  if (isGuesser) {
    return (
      <>
        <Waiting>{s.guesserWaitsClues}</Waiting>
        <Progress {...props} />
      </>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      await actions.submitClue(text)
      setText('')
    })
  }

  return (
    <>
      {snapshot.word && <SecretWord word={snapshot.word} />}
      {own && <p className="center">{s.clueSaved(own.clue)}</p>}
      <form className="card stack" onSubmit={submit}>
        <label>
          {s.yourClue}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={30}
            autoComplete="off"
          />
        </label>
        <button className="button" disabled={busy || !text.trim()}>
          {own ? s.changeClue : s.submitClue}
        </button>
      </form>
      <Progress {...props} />
    </>
  )
}

export function ReviewingClues(props: PhaseProps) {
  const { snapshot, userId, playerIds, nameOf, isGuesser, isHost, actions, busy, run } = props
  if (isGuesser) return <Waiting>{s.guesserWaitsReview}</Waiting>

  const { confirmed_ids } = snapshot.game
  const majority = Math.floor((playerIds.length - 1) / 2) + 1
  const hasConfirmed = confirmed_ids.includes(userId)
  return (
    <>
      {snapshot.word && <SecretWord word={snapshot.word} />}
      <h2>{s.reviewTitle}</h2>
      <p className="muted">{s.reviewHint}</p>
      <ul className="clue-list">
        {snapshot.clues.map((c) => (
          <li key={c.player_id}>
            <button
              className={isCancelled(c) ? 'clue cancelled' : 'clue'}
              aria-pressed={isCancelled(c)}
              disabled={busy || c.auto_cancelled}
              onClick={() => run(() => actions.toggleClue(c.player_id))}
            >
              <span className="clue-text">{c.clue}</span>
              <span className="muted">
                {nameOf(c.player_id)}
                {isCancelled(c) &&
                  ` · ${c.auto_cancelled ? s.autoCancelled : s.manualCancelled}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        className="button"
        disabled={busy || (hasConfirmed && !isHost)}
        onClick={() => run(actions.confirmReview)}
      >
        {hasConfirmed && !isHost ? s.confirmed : s.confirm}
      </button>
      <p className="muted center">{s.confirmStatus(confirmed_ids.length, majority)}</p>
    </>
  )
}

export function Guessing({ snapshot, nameOf, isGuesser, actions, busy, run }: PhaseProps) {
  const [text, setText] = useState('')

  if (!isGuesser) {
    return (
      <>
        {snapshot.word && <SecretWord word={snapshot.word} />}
        <ClueList clues={snapshot.clues} nameOf={nameOf} />
        <p className="muted center">{s.waitingForGuess(nameOf(snapshot.game.guesser_id))}</p>
      </>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    run(() => actions.submitGuess(text))
  }

  return (
    <>
      <h2>{s.cluesForYou}</h2>
      <ClueList clues={snapshot.clues} nameOf={nameOf} />
      <form className="card stack" onSubmit={submit}>
        <label>
          {s.yourGuess}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <button className="button" disabled={busy || !text.trim()}>
          {s.guess}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm(s.confirmPass)) run(() => actions.submitGuess(null))
          }}
        >
          {s.pass}
        </button>
      </form>
    </>
  )
}

export function RoundResult({
  snapshot,
  nameOf,
  isGuesser,
  isHost,
  actions,
  busy,
  run,
}: PhaseProps) {
  const { game, history, word, clues } = snapshot
  const entry = history.find((h) => h.round_no === game.round_no)
  if (!entry) return null
  // The card of this round is only counted when the next round starts.
  const isLastCard = game.cards_used + 1 >= game.cards_total
  const isFinal = game.cards_used + (entry.result === 'wrong' ? 2 : 1) >= game.cards_total
  const headline = {
    correct: s.resultCorrect,
    wrong: s.resultWrong,
    pass: s.resultPass,
  }[entry.result]

  return (
    <>
      <section className={`card center result ${entry.result}`}>
        <p className="result-headline">{headline}</p>
        {entry.guess && <p>{s.guessWas(entry.guess)}</p>}
        {entry.result === 'wrong' && (
          <p className="muted">{isLastCard ? s.wrongPenaltyLast : s.wrongPenalty}</p>
        )}
      </section>
      {word && <SecretWord word={word} />}
      {clues.length > 0 && <ClueList clues={clues} nameOf={nameOf} />}
      {entry.result === 'wrong' && !isGuesser && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => run(actions.acceptGuess)}
        >
          {s.acceptAnyway}
        </button>
      )}
      {!isGuesser || isHost ? (
        <button className="button" disabled={busy} onClick={() => run(actions.nextRound)}>
          {isFinal ? s.finish : s.nextRound}
        </button>
      ) : (
        <p className="muted center">{s.waitingForNext}</p>
      )}
    </>
  )
}
