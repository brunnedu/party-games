import type { Snapshot, Team } from './api'

export function teamTotal(points: Snapshot['points'], team: Team) {
  return points.filter((p) => p.team === team).reduce((sum, p) => sum + p.points, 0)
}

export function modePoints(points: Snapshot['points'], team: Team, mode: number) {
  return points.find((p) => p.team === team && p.mode === mode)?.points ?? 0
}

/** "0:07"; a started second counts as a full one. */
export function clockText(ms: number) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
