// The reveal: one answer at a time, with claims, objections and "Weiter".
import { useState } from 'react'
import { Avatar } from '../../core/ui/Avatar'
import { Waiting } from '../../core/ui/Waiting'
import type { Claim, LastReading, OwnCell } from './api'
import { Grid, type CellView } from './Grid'
import { looksSimilar } from './match'
import type { PhaseProps } from './phases'
import { s } from './strings.de'
import { useUnlock } from './useUnlock'

/** A claim that differs from what the app preselected. */
const isChange = (c: Claim) => c.cell !== c.auto_cell || c.also.length > 0

const quoted = (answers: string[]) => answers.map((a) => `«${a}»`).join(', ')

function LastResult({ last, nameOf }: { last: LastReading; nameOf: (id: string) => string }) {
  const names = [last.reader_id, ...last.matches.map((m) => m.player_id)].map(nameOf)
  const list = `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`
  return (
    <section className="card center dito-last" aria-live="polite">
      <h2>{s.lastTitle(last.answer)}</h2>
      <p>
        {last.matches.length === 0
          ? s.lastNone(nameOf(last.reader_id))
          : last.matches.length === 1
            ? s.lastBff(list)
            : s.lastMany(list)}
      </p>
    </section>
  )
}

function OpenCounts({ snapshot, nameOf, playerOf }: PhaseProps) {
  const { game } = snapshot
  return (
    <section className="card">
      <h2>{s.openAnswers}</h2>
      <ul className="dito-open-counts">
        {game.order_ids.map((id) => (
          <li key={id} className={id === game.reader_id ? 'reader' : undefined}>
            <Avatar player={playerOf(id)} small />
            <span className="player-name">{nameOf(id)}</span>
            <strong>{game.open_counts[id] ?? 0}</strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The reader picks an answer; everyone else waits. */
function PickAnswer(props: PhaseProps) {
  const { snapshot, userId, nameOf, actions, busy, run } = props
  const { game, own } = snapshot
  const isReader = game.reader_id === userId
  const [selected, setSelected] = useState<number | null>(null)
  const chosen = own.find((c) => c.cell === selected && c.state === 'open')

  return (
    <>
      {game.last_reading && <LastResult last={game.last_reading} nameOf={nameOf} />}
      {!isReader && <Waiting icon="🗣️">{s.waitingForAnswer(nameOf(game.reader_id!))}</Waiting>}
      <section className="card stack">
        <h2>{isReader ? s.youRead : s.yourGrid}</h2>
        {isReader && <p className="muted">{s.pickAnswer}</p>}
        <Grid
          label={s.yourGrid}
          cell={(index) => {
            const c = own.find((x) => x.cell === index)
            if (!c) return {}
            return {
              text: c.answer,
              state: c.state,
              star: c.star,
              mark: isReader && selected === index ? 'selected' : undefined,
              onClick: isReader && c.state === 'open' ? () => setSelected(index) : undefined,
            }
          }}
        />
        {isReader && (
          <button
            className="button"
            disabled={busy || !chosen}
            onClick={() => run(() => actions.read(chosen!.cell))}
          >
            {chosen ? s.readThis(chosen.answer) : s.readFirst}
          </button>
        )}
      </section>
      <OpenCounts {...props} />
    </>
  )
}

/** Your grid while an answer is being read: tap to claim or to cross out. */
function ClaimGrid({
  read,
  mine,
  isReader,
  own,
  busy,
  locked,
  onClaim,
}: {
  read: string
  mine: Claim
  isReader: boolean
  own: OwnCell[]
  busy: boolean
  locked: boolean
  onClaim: (cell: number | null, also: number[]) => void
}) {
  // A second answer needs a choice: circle it instead, or cross it out too.
  const [menu, setMenu] = useState<number | null>(null)
  const other = own.find((c) => c.cell === menu && c.state === 'open')

  function tap(index: number) {
    if (isReader) {
      if (index === mine.cell) return
      onClaim(
        mine.cell,
        mine.also.includes(index)
          ? mine.also.filter((c) => c !== index)
          : [...mine.also, index],
      )
    } else if (mine.cell === null) {
      onClaim(index, [])
    } else if (index === mine.cell) {
      onClaim(null, [])
    } else {
      setMenu(menu === index ? null : index)
    }
  }

  return (
    <>
      <p className="muted">
        {isReader || mine.cell !== null
          ? mine.cell !== null && !isReader && mine.cell === mine.auto_cell
            ? `${s.claimHelpAuto} ${s.alsoHelp}`
            : s.alsoHelp
          : s.claimHelp}
      </p>
      <Grid
        label={s.yourGrid}
        cell={(index) => {
          const c = own.find((x) => x.cell === index)
          if (!c) return {}
          const view: CellView = { text: c.answer, state: c.state, star: c.star }
          if (c.state !== 'open') return view
          if (index === mine.cell) view.mark = 'claimed'
          else if (mine.also.includes(index)) view.mark = 'crossing'
          else if (menu === index) view.mark = 'selected'
          else if (mine.cell === null && looksSimilar(read, c.answer)) {
            view.mark = 'hint'
            view.note = s.maybe
          }
          if (!locked && !busy) view.onClick = () => tap(index)
          return view
        }}
      />
      {other && !locked && !isReader && mine.cell !== null && (
        <div className="stack dito-menu">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setMenu(null)
              onClaim(other.cell, mine.also.filter((c) => c !== other.cell))
            }}
          >
            {s.circleInstead(other.answer)}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setMenu(null)
              onClaim(
                mine.cell,
                mine.also.includes(other.cell)
                  ? mine.also.filter((c) => c !== other.cell)
                  : [...mine.also, other.cell],
              )
            }}
          >
            {mine.also.includes(other.cell)
              ? s.keepOpen(other.answer)
              : s.alsoCross(other.answer)}
          </button>
          <button className="link-button" onClick={() => setMenu(null)}>
            {s.cancel}
          </button>
        </div>
      )}
    </>
  )
}

function ObjectionCard(props: PhaseProps & { read: string }) {
  const { snapshot, userId, nameOf, isHost, actions, busy, run, read } = props
  const { game, claims } = snapshot
  const objection = game.objection!
  const target = claims.find((c) => c.player_id === objection.target_id)
  const canClose = useUnlock(`${game.step}:${objection.no}`, 15_500)
  const isTarget = objection.target_id === userId
  const voters = game.order_ids.filter((id) => id !== objection.target_id)
  const voted = objection.voted_ids.includes(userId)
  if (!target) return null

  // What exactly was changed, compared with the preselection.
  const removed = target.cell === null
  const moved = target.cell !== target.auto_cell
  return (
    <section className="card stack center dito-objection" role="alert">
      <h2>{s.objectionTitle}</h2>
      <p className="muted">
        {s.objectionBy(nameOf(objection.by_id), nameOf(objection.target_id))}
      </p>
      {moved && (
        <p className="dito-objection-question">
          {removed ? s.objectionRemove(read) : s.objectionClaim(read, target.answer!)}
        </p>
      )}
      {target.also.length > 0 && <p>{s.objectionAlso(quoted(target.also_text))}</p>}
      {removed && <p className="muted">{s.objectionRemoveHelp}</p>}
      <p className="muted">{s.objectionHelp}</p>
      {isTarget ? (
        <p>{s.othersVote}</p>
      ) : (
        <>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => run(() => actions.vote(objection.no, true))}
          >
            {s.voteAccept}
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => run(() => actions.vote(objection.no, false))}
          >
            {s.voteReject}
          </button>
          {voted && <p className="muted">{s.voted}</p>}
        </>
      )}
      <p className="muted" aria-live="polite">
        {s.votesIn(objection.voted_ids.length, voters.length)}
      </p>
      {isHost && (
        <button
          className="link-button"
          disabled={busy || !canClose}
          onClick={() => run(() => actions.closeVote(objection.no))}
        >
          {s.closeVote}
        </button>
      )}
    </section>
  )
}

/** An answer is being read. */
function Reading(props: PhaseProps) {
  const { snapshot, userId, nameOf, playerOf, actions, busy, run } = props
  const { game, claims, own } = snapshot
  const isReader = game.reader_id === userId
  const readerClaim = claims.find((c) => c.player_id === game.reader_id)
  const mine = claims.find((c) => c.player_id === userId)
  const ready = useUnlock(`${game.step}:${game.revision}`, 5_300)
  const read = readerClaim?.answer ?? ''

  // Everyone who has the answer or changed something, in seating order.
  const shown = game.order_ids
    .map((id) => claims.find((c) => c.player_id === id))
    .filter((c): c is Claim => {
      if (!c) return false
      return c.player_id === game.reader_id ? c.also.length > 0 : c.cell !== null || isChange(c)
    })

  return (
    <>
      <section className="card center secret dito-read">
        <p className="muted">
          {isReader ? s.youReadLabel : s.readsLabel(nameOf(game.reader_id!))}
        </p>
        <p className="secret-word">{read}</p>
      </section>

      {game.objection && <ObjectionCard {...props} read={read} />}

      <section className="card stack">
        <h2>{s.claimsTitle}</h2>
        {shown.length === 0 ? (
          <p className="muted">{s.noClaims}</p>
        ) : (
          <ul className="dito-claims" aria-live="polite">
            {shown.map((c) => (
              <li key={c.player_id}>
                <Avatar player={playerOf(c.player_id)} small />
                <span className="dito-claim-text">
                  <span className="player-name">{nameOf(c.player_id)}</span>
                  {c.player_id !== game.reader_id && (
                    <>
                      <span>{c.cell === null ? s.removed : `«${c.answer}»`}</span>
                      <span className="tag">
                        {c.settled ? s.settled : isChange(c) ? s.manual : s.automatic}
                      </span>
                    </>
                  )}
                  {c.also.length > 0 && (
                    <span className="muted">{s.crosses(quoted(c.also_text))}</span>
                  )}
                </span>
                {c.player_id !== userId && isChange(c) && !c.settled && !game.objection && (
                  <button
                    className="dito-object-button"
                    aria-label={s.objectTo(nameOf(c.player_id))}
                    disabled={busy}
                    onClick={() => run(() => actions.object(c.player_id, c.rev))}
                  >
                    {s.object}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mine && (
        <section className="card stack">
          <h2>{s.yourGrid}</h2>
          <ClaimGrid
            read={read}
            mine={mine}
            isReader={isReader}
            own={own}
            busy={busy}
            locked={mine.settled || Boolean(game.objection)}
            onClaim={(cell, also) => run(() => actions.claim(cell, also))}
          />
        </section>
      )}

      {isReader ? (
        <>
          <button
            className="button"
            disabled={busy || !ready || Boolean(game.objection)}
            onClick={() => run(() => actions.confirm(game.revision))}
          >
            {ready ? s.next : s.nextSoon}
          </button>
          <p className="muted center">{s.nextHelp}</p>
        </>
      ) : (
        <p className="muted center">{s.waitingForReader(nameOf(game.reader_id!))}</p>
      )}
      <OpenCounts {...props} />
    </>
  )
}

export function Reveal(props: PhaseProps) {
  return props.snapshot.game.read_cell === null ? (
    <PickAnswer {...props} />
  ) : (
    <Reading {...props} />
  )
}
