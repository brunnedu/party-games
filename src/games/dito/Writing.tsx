// Choosing a category and writing three answers into free cells.
import { useState, type FormEvent } from 'react'
import { AvatarProgress, Waiting } from '../../core/ui/Waiting'
import { Grid } from './Grid'
import { isLong, normalize } from './match'
import type { PhaseProps } from './phases'
import { s } from './strings.de'

export function Choosing({ snapshot, userId, nameOf, actions, busy, run }: PhaseProps) {
  const { game, options, own } = snapshot
  return (
    <>
      {game.chooser_id === userId && options ? (
        <section className="card stack">
          <h2>{s.chooseTitle}</h2>
          <p className="muted">{s.chooseHelp}</p>
          {options.map((option) => (
            <button
              key={option}
              className="dito-category-option"
              disabled={busy}
              onClick={() => run(() => actions.choose(option))}
            >
              {option}
            </button>
          ))}
        </section>
      ) : (
        <Waiting icon="🤔">{s.waitingForChoice(nameOf(game.chooser_id))}</Waiting>
      )}
      {own.length > 0 && (
        <section className="card stack">
          <h2>{s.yourGrid}</h2>
          <Grid
            label={s.yourGrid}
            cell={(index) => ({ text: own.find((c) => c.cell === index)?.answer })}
          />
        </section>
      )}
    </>
  )
}

interface Draft {
  text: string
  cell: number | null
}

export function Writing({ snapshot, playerOf, actions, busy, run }: PhaseProps) {
  const { game, own } = snapshot
  const earlier = own.filter((c) => c.category_no !== game.category_no)
  const saved = own.filter((c) => c.category_no === game.category_no)
  // A new key per screen resets this, and a reload picks up what was saved.
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    [0, 1, 2].map((i) => ({ text: saved[i]?.answer ?? '', cell: saved[i]?.cell ?? null })),
  )
  // The answer that the next tap on the grid places.
  const [active, setActive] = useState(0)

  const filled = drafts.map((d) => d.text.trim()).filter(Boolean)
  const used = [...earlier.map((c) => c.answer), ...filled].map(normalize)
  const repeated = new Set(used).size < used.length
  const complete = filled.length === 3 && drafts.every((d) => d.cell !== null)
  const changed = drafts.some(
    (d) => !saved.some((c) => c.cell === d.cell && c.answer === d.text.trim()),
  )

  function setText(index: number, text: string) {
    setDrafts((all) => all.map((d, i) => (i === index ? { ...d, text } : d)))
  }

  function place(cell: number) {
    const next = drafts.map((d, i) => {
      if (i === active) return { ...d, cell }
      // Another new answer was there: the two swap places.
      return d.cell === cell ? { ...d, cell: drafts[active]!.cell } : d
    })
    setDrafts(next)
    const unplaced = next.findIndex((d) => d.cell === null)
    if (unplaced >= 0) setActive(unplaced)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!complete || repeated) return
    run(() =>
      actions.submit(
        drafts.map((d) => d.cell!),
        drafts.map((d) => d.text),
      ),
    )
  }

  return (
    <>
      <section className="card dito-category">
        <p className="muted">{s.category(game.category_no)}</p>
        <p className="dito-category-name">{game.categories.at(-1)}</p>
      </section>
      <form className="card stack" onSubmit={submit}>
        <p className="muted">{s.writeHelp}</p>
        {drafts.map((draft, i) => (
          <div key={i} className={active === i ? 'dito-input active' : 'dito-input'}>
            <button
              type="button"
              className="dito-number"
              aria-label={s.place(i + 1)}
              aria-pressed={active === i}
              onClick={() => setActive(i)}
            >
              {i + 1}
            </button>
            <input
              aria-label={s.answerLabel(i + 1)}
              placeholder={s.answerLabel(i + 1)}
              value={draft.text}
              onChange={(e) => setText(i, e.target.value)}
              onFocus={() => setActive(i)}
              maxLength={60}
              autoComplete="off"
              // Enter must not send while fields are still empty.
              enterKeyHint={i < 2 ? 'next' : 'done'}
            />
          </div>
        ))}
        <p className="muted center">{s.placing(active + 1)}</p>
        <Grid
          label={s.yourGrid}
          cell={(index) => {
            const old = earlier.find((c) => c.cell === index)
            if (old) return { text: old.answer }
            const i = drafts.findIndex((d) => d.cell === index)
            return {
              text: i >= 0 ? drafts[i]!.text || '…' : undefined,
              note: i >= 0 ? String(i + 1) : undefined,
              mark: i === active ? 'selected' : i >= 0 ? 'claimed' : undefined,
              onClick: () => place(index),
            }
          }}
        />
        {drafts.some((d) => isLong(d.text)) && <p className="dito-warning">{s.longWarning}</p>}
        {repeated && (
          <p className="error" role="alert">
            {s.repeatWarning}
          </p>
        )}
        <p className="muted">{s.spellingHint}</p>
        <button
          className="button"
          disabled={busy || !complete || repeated || (saved.length > 0 && !changed)}
        >
          {saved.length > 0 ? s.change : s.submit}
        </button>
        {saved.length > 0 && !changed && <p className="center">{s.saved}</p>}
      </form>
      <AvatarProgress ids={game.order_ids} doneIds={game.submitted_ids} playerOf={playerOf} />
      <p className="muted center" aria-live="polite">
        {s.progress(game.submitted_ids.length, game.order_ids.length)}
      </p>
    </>
  )
}
