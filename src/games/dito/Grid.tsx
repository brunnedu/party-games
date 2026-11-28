// The 3x3 grid with its bonus points: rows on the right, columns underneath.
import { Fragment, type ReactNode } from 'react'
import type { Cell } from './api'
import { COLUMN_BONUS, ROW_BONUS } from './scoring'
import { s } from './strings.de'

export interface CellView {
  text?: ReactNode
  state?: Cell['state']
  star?: boolean
  /** Extra look: the answer being placed or read, a claim, or a hint. */
  mark?: 'selected' | 'claimed' | 'crossing' | 'hint'
  note?: string
  /** Makes the cell a button. */
  onClick?: () => void
}

export function Grid({
  label,
  cell,
  small,
}: {
  label: string
  cell: (index: number) => CellView
  small?: boolean
}) {
  return (
    <div className={small ? 'dito-grid small' : 'dito-grid'} role="group" aria-label={label}>
      {ROW_BONUS.map((rowBonus, row) => (
        <Fragment key={row}>
          {[0, 1, 2].map((column) => {
            const index = row * 3 + column
            const view = cell(index)
            const state = view.state ?? 'open'
            const classes = ['dito-cell', state, view.mark].filter(Boolean).join(' ')
            const description = [
              s.cellLabel(row + 1, column + 1),
              typeof view.text === 'string' ? view.text : '',
              state === 'open' ? '' : s.states[state],
              view.star ? s.star : '',
              view.note ?? '',
            ]
              .filter(Boolean)
              .join(', ')
            const content = (
              <>
                <span className="dito-answer">{view.text}</span>
                {view.star && (
                  <span className="dito-star" aria-hidden>
                    ★
                  </span>
                )}
                {view.note && <span className="dito-note">{view.note}</span>}
              </>
            )
            return view.onClick ? (
              <button
                key={index}
                type="button"
                className={classes}
                aria-label={description}
                aria-pressed={view.mark === 'selected' || view.mark === 'claimed'}
                onClick={view.onClick}
              >
                {content}
              </button>
            ) : (
              <div key={index} className={classes} title={description}>
                {content}
              </div>
            )
          })}
          <span className="dito-bonus" title={s.rowBonus(rowBonus)}>
            {rowBonus}
          </span>
        </Fragment>
      ))}
      {COLUMN_BONUS.map((bonus, column) => (
        <span key={column} className="dito-bonus" title={s.columnBonus(bonus)}>
          {bonus}
        </span>
      ))}
    </div>
  )
}

/** A grid to look at, such as in the round summary. */
export function ResultGrid({ label, cells, small }: { label: string; cells: Cell[]; small?: boolean }) {
  return (
    <Grid
      label={label}
      small={small}
      cell={(index) => {
        const found = cells.find((c) => c.cell === index)
        return found ? { text: found.answer, state: found.state, star: found.star } : {}
      }}
    />
  )
}
