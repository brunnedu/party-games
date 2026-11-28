// One component per phase of a round.
import { useState, type FormEvent } from 'react'
import type { Player, Room } from '../../core/room/api'
import { Avatar } from '../../core/ui/Avatar'
import { Confetti } from '../../core/ui/Confetti'
import { InviteBanner } from '../../core/ui/Invite'
import { Scoreboard } from '../../core/ui/Scoreboard'
import { AvatarProgress, Waiting } from '../../core/ui/Waiting'
import type { Reveal, RoundActions, Snapshot, SphinxAnswer } from './api'
import { pointsBreakdown } from './breakdown'
import { Sentence, SentenceCard } from './Sentence'
import { s } from './strings.de'

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

export function Choosing({ snapshot, userId, nameOf, actions, busy, run }: PhaseProps) {
  const { game, options } = snapshot
  if (game.sphinx_id !== userId || !options) {
    return <Waiting icon="🤔">{s.waitingForChoice(nameOf(game.sphinx_id))}</Waiting>
  }
  return (
    <>
      <h2>{s.chooseTitle}</h2>
      <ul className="sentence-options">
        {options.map((option) => (
          <li key={option}>
            <button
              className="card sentence-option"
              disabled={busy}
              onClick={() => run(() => actions.choose(option))}
            >
              <Sentence text={option} />
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Only on the Sphinx's phone: every text, without who wrote it. */
function SphinxList({ answers }: { answers: SphinxAnswer[] }) {
  return (
    <ol className="sphinx-list">
      {answers.map((a, i) => (
        <li key={`${i}:${a.answer}`} className={a.is_real ? 'real' : undefined}>
          <span className="answer-number">{a.number ?? '•'}</span>
          <span>
            <span className="answer-text">{a.answer}</span>
            {a.is_real && <span className="real-mark">{s.realMark}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function AnswerForm({
  label,
  help,
  submitLabel,
  initial,
  busy,
  onSubmit,
}: {
  label: string
  help: string
  submitLabel: string
  initial: string
  busy: boolean
  onSubmit: (answer: string) => void
}) {
  const [text, setText] = useState(initial)
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit(text)
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <label>
        {label}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={100}
          autoComplete="off"
        />
      </label>
      <p className="muted">{help}</p>
      <button className="button" disabled={busy || !text.trim() || text.trim() === initial}>
        {submitLabel}
      </button>
    </form>
  )
}

export function Writing(props: PhaseProps) {
  const { snapshot, userId, nameOf, playerOf, actions, busy, run } = props
  const { game, own } = snapshot
  const isSphinx = game.sphinx_id === userId
  const sphinxName = nameOf(game.sphinx_id)
  const participates = game.player_ids.includes(userId)
  const list = snapshot.private.sphinx_answers
  const complete = game.player_ids.every((id) => game.submitted_ids.includes(id))

  return (
    <>
      <SentenceCard text={game.sentence ?? ''} />
      {isSphinx && !own && (
        <AnswerForm
          label={s.truthLabel}
          help={s.truthWarning}
          submitLabel={s.submitTruth}
          initial=""
          busy={busy}
          onSubmit={(answer) => run(() => actions.submit(answer))}
        />
      )}
      {isSphinx && list && (
        <section className="card stack">
          <h2>{s.practiceTitle}</h2>
          <p className="muted">{s.practiceHelp}</p>
          <SphinxList answers={list} />
          <button
            className="button secondary"
            disabled={busy || list.length < 2}
            onClick={() => run(actions.shuffle)}
          >
            {s.shuffle}
          </button>
          <button
            className="button"
            disabled={busy || !complete}
            onClick={() => run(actions.startReading)}
          >
            {s.startReading}
          </button>
          {!complete && <p className="muted center">{s.waitingForAnswers}</p>}
        </section>
      )}
      {!isSphinx && participates && (
        <>
          {own && <p className="center">{s.yourAnswer(own.answer)}</p>}
          <AnswerForm
            // Reset the field to the saved answer after each submit.
            key={own?.answer ?? ''}
            label={s.fakeLabel(sphinxName)}
            help={s.fakeHelp}
            submitLabel={own ? s.change : s.submit}
            initial={own?.answer ?? ''}
            busy={busy}
            onSubmit={(answer) => run(() => actions.submit(answer))}
          />
        </>
      )}
      {!participates && <Waiting>{s.watching}</Waiting>}
      <AvatarProgress ids={game.player_ids} doneIds={game.submitted_ids} playerOf={playerOf} />
      <p className="muted center" aria-live="polite">
        {s.progress(game.submitted_ids.length, game.player_ids.length)}
      </p>
    </>
  )
}

export function Voting(props: PhaseProps) {
  const { snapshot, userId, nameOf, playerOf, actions, busy, run } = props
  const { game, own, own_vote } = snapshot
  const isSphinx = game.sphinx_id === userId
  const participates = game.player_ids.includes(userId)
  const [selected, setSelected] = useState(own_vote)
  const guessers = game.player_ids.filter((id) => id !== game.sphinx_id)
  const ownNumber = own?.number ?? null
  const numbers = Array.from({ length: game.answer_count }, (_, i) => i + 1)

  return (
    <>
      <SentenceCard text={game.sentence ?? ''} />
      {isSphinx && (
        <section className="card stack">
          <h2>{s.readTitle}</h2>
          <p className="muted">{s.readHelp}</p>
          <SphinxList answers={snapshot.private.sphinx_answers ?? []} />
        </section>
      )}
      {!isSphinx && (
        <section className="card stack">
          <p className="muted center">{s.listen(nameOf(game.sphinx_id))}</p>
          {participates ? (
            <>
              <h2>{s.voteTitle}</h2>
              <div className="number-grid" role="group" aria-label={s.voteTitle}>
                {numbers.map((n) => (
                  <button
                    key={n}
                    className="number-button"
                    aria-pressed={selected === n}
                    // Your own only if someone wrote the same: it may be the truth.
                    disabled={n === ownNumber && !snapshot.private.has_twin}
                    onClick={() => setSelected(n)}
                  >
                    {n}
                    {n === ownNumber && <small>{s.own}</small>}
                  </button>
                ))}
              </div>
              {ownNumber !== null && <p className="muted center">{s.ownNumber(ownNumber)}</p>}
              {own_vote !== null && <p className="center">{s.votedFor(own_vote)}</p>}
              <button
                className="button"
                disabled={busy || selected === null || selected === own_vote}
                onClick={() => run(() => actions.vote(selected!))}
              >
                {own_vote === null ? s.vote : s.changeVote}
              </button>
            </>
          ) : (
            <p className="muted center">{s.watching}</p>
          )}
        </section>
      )}
      <AvatarProgress ids={guessers} doneIds={game.voted_ids} playerOf={playerOf} />
      <p className="muted center" aria-live="polite">
        {s.votesIn(game.voted_ids.length, guessers.length)}
      </p>
    </>
  )
}

function RevealCard({
  reveal,
  nameOf,
  playerOf,
}: { reveal: Reveal } & Pick<PhaseProps, 'nameOf' | 'playerOf'>) {
  const authors = (real: boolean) =>
    reveal.entries
      .filter((e) => Boolean(e.is_real) === real)
      .map((e) => nameOf(e.player_id ?? ''))
      .join(' & ')
  const fakeAuthors = authors(false)
  const truth = reveal.is_truth === true

  return (
    <li className={truth ? 'card reveal-card truth' : 'card reveal-card'}>
      {reveal.entries.map((e) => (
        <p key={e.number} className="reveal-answer">
          <span className="answer-number">{e.number}</span>
          <span className="answer-text">{e.answer}</span>
        </p>
      ))}
      <div className="voters">
        {reveal.votes.length === 0 ? (
          <span className="muted">{s.noVotes}</span>
        ) : (
          <>
            <span className="muted">{s.votedBy}</span>
            {reveal.votes.map((v) => (
              <span key={v.voter_id} className="voter">
                <Avatar player={playerOf(v.voter_id)} small />
                {nameOf(v.voter_id)}
              </span>
            ))}
          </>
        )}
      </div>
      {reveal.resolved &&
        (truth ? (
          <>
            <p className="stamp">{s.stamp}</p>
            {fakeAuthors && <p>{s.alsoWrote(fakeAuthors)}</p>}
          </>
        ) : (
          <p className="written-by">{s.writtenBy(fakeAuthors)}</p>
        ))}
      {reveal.resolved && reveal.entries.length > 1 && <p className="muted">{s.twinNote}</p>}
    </li>
  )
}

export function Revealing(props: PhaseProps) {
  const { snapshot, room, players, userId, nameOf, playerOf, isHost, actions, busy, run } = props
  const { game, reveals, scores } = snapshot
  const isSphinx = game.sphinx_id === userId
  const done = game.reveal_step >= game.reveal_steps
  const isFinal = done && game.rounds_played >= game.rounds_total
  const gained = Object.entries(game.round_points ?? {}).sort((a, b) => b[1] - a[1])
  const iScored = Boolean(game.round_points?.[userId])
  const breakdown = done ? pointsBreakdown(reveals, game.sphinx_id, game.sphinx_foul) : {}
  // Newest on top, so nobody has to scroll to see what just happened. Sorted by
  // position, which is the order of revealing.
  const newestFirst = [...reveals].sort((a, b) => b.position - a.position)
  const pending = reveals.some((r) => !r.resolved)

  return (
    <>
      <SentenceCard text={game.sentence ?? ''} />
      {!done &&
        (isSphinx ? (
          <button
            className="button reveal-button"
            disabled={busy}
            onClick={() => run(() => actions.revealNext(game.reveal_step))}
          >
            {game.reveal_step === 0 ? s.revealStart : pending ? s.revealVoters : s.revealNext}
          </button>
        ) : (
          <p className="muted center">{s.revealWaiting(nameOf(game.sphinx_id))}</p>
        ))}
      {done && (
        <>
          {iScored && <Confetti />}
          <section className="card stack">
            <h2>{s.roundPoints}</h2>
            {game.sphinx_foul && <p>{s.foul}</p>}
            {gained.length === 0 ? (
              <p className="muted">{s.noPoints}</p>
            ) : (
              <ul className="player-list">
                {gained.map(([id, points]) => (
                  <li key={id}>
                    <Avatar player={playerOf(id)} small />
                    <span className="point-source">
                      <span className="player-name">{nameOf(id)}</span>
                      {(['truth', 'fake', 'sphinx'] as const).map((kind) => {
                        const n = breakdown[id]?.[kind]
                        return n ? (
                          <span key={kind} className="muted">
                            {s.reasons[kind](n)}
                          </span>
                        ) : null
                      })}
                    </span>
                    <strong className="gained">{s.gained(points)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>{s.scores}</h2>
            <Scoreboard players={players} scores={scores} userId={userId} />
          </section>
          {!isFinal && <InviteBanner room={room} text={s.joinNow(room.code)} />}
          {isHost || isSphinx ? (
            <button className="button" disabled={busy} onClick={() => run(actions.nextRound)}>
              {isFinal ? s.finish : s.nextRound}
            </button>
          ) : (
            <p className="muted center">{s.waitingForNext}</p>
          )}
        </>
      )}
      <ul className="reveal-list" aria-live="polite">
        {newestFirst.map((reveal) => (
          <RevealCard
            key={reveal.position}
            reveal={reveal}
            nameOf={nameOf}
            playerOf={playerOf}
          />
        ))}
      </ul>
      {isSphinx && !done && (
        <details className="card">
          <summary>{s.practiceTitle}</summary>
          <SphinxList answers={snapshot.private.sphinx_answers ?? []} />
        </details>
      )}
    </>
  )
}
