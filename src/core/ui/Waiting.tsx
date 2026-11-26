import type { ReactNode } from 'react'
import type { Player } from '../room/api'
import { Avatar } from './Avatar'
import './game.css'

export function Waiting({ icon = '✏️', children }: { icon?: string; children: ReactNode }) {
  return (
    <section className="card center waiting">
      <span className="waiting-icon" aria-hidden>
        {icon}
      </span>
      <p className="muted">{children}</p>
    </section>
  )
}

/** Avatars of the players something is expected from, with a check once done. */
export function AvatarProgress({
  ids,
  doneIds,
  playerOf,
}: {
  ids: string[]
  doneIds: string[]
  playerOf: (id: string) => Player | undefined
}) {
  return (
    <ul className="givers">
      {ids.map((id) => {
        const done = doneIds.includes(id)
        return (
          <li key={id} className={done ? 'giver done' : 'giver'}>
            <Avatar player={playerOf(id)} checked={done} />
            {playerOf(id)?.name}
          </li>
        )
      })}
    </ul>
  )
}
