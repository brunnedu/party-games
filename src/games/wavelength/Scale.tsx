import type { ComponentProps, ReactNode } from 'react'
import { useHold } from '../../core/ui/useHold'
import { Dial } from './Dial'
import { s } from './strings.de'

/** The dial with the two ends of the scale underneath. */
export function Scale({
  left,
  right,
  children,
}: {
  left: string
  right: string
  children: ReactNode
}) {
  return (
    <section className="card scale">
      {children}
      <div className="scale-ends">
        <span className="scale-end">
          <span aria-hidden>←</span>
          {left}
        </span>
        <span className="scale-end">
          <span aria-hidden>→</span>
          {right}
        </span>
      </div>
    </section>
  )
}

/** The clue-giver's view: the target is only visible while the button is held. */
export function SecretDial({
  left,
  right,
  target,
  ...dial
}: { left: string; right: string; target: number | null } & Pick<
  ComponentProps<typeof Dial>,
  'value'
>) {
  const { held, holdProps } = useHold()
  return (
    <>
      <Scale left={left} right={right}>
        <Dial {...dial} target={held ? target : null} />
      </Scale>
      <button type="button" className="button secondary hold-button" {...holdProps}>
        {held ? s.releaseToHide : s.holdToPeek}
      </button>
    </>
  )
}
