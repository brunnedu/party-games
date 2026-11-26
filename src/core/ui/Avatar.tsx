import type { CSSProperties } from 'react'
import type { Player } from '../room/api'

// Assigned by seat, so everyone sees the same avatar without storing anything.
const AVATARS: readonly [animal: string, color: string][] = [
  ['🦊', '#f2a65a'],
  ['🐸', '#a7cf7a'],
  ['🐙', '#e99bb0'],
  ['🦉', '#c9a77f'],
  ['🐳', '#8fc1de'],
  ['🐝', '#f4d35e'],
  ['🦄', '#c8aee3'],
  ['🐢', '#85c2a6'],
  ['🐼', '#cfd3c4'],
  ['🦁', '#eec07b'],
  ['🐧', '#a9b8e0'],
  ['🦀', '#ee9682'],
]

export function avatarFor(player: Player | undefined): { icon: string; color?: string } {
  if (!player) return { icon: '👤' }
  const [icon, color] = AVATARS[(player.seat_order - 1) % AVATARS.length]!
  return { icon, color }
}

export function Avatar({
  player,
  small,
  offline,
  checked,
}: {
  /** Undefined for someone who has left the room. */
  player: Player | undefined
  small?: boolean
  offline?: boolean
  checked?: boolean
}) {
  const { icon, color } = avatarFor(player)
  const classes = ['avatar', small && 'small', offline && 'offline'].filter(Boolean).join(' ')
  return (
    <span className={classes} style={{ '--avatar-color': color } as CSSProperties} aria-hidden>
      {icon}
      {checked && <span className="avatar-badge">✓</span>}
    </span>
  )
}
