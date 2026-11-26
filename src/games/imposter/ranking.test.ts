import { describe, expect, it } from 'vitest'
import { ranking } from './ranking'

describe('ranking', () => {
  it('sorts by score, shares ranks and counts missing scores as zero', () => {
    const players = ['a', 'b', 'c', 'd'].map((user_id) => ({ user_id }))
    const result = ranking(players, { b: 3, c: 3, d: 1, gone: 9 })
    expect(result.map((r) => [r.player.user_id, r.score, r.rank])).toEqual([
      ['b', 3, 1],
      ['c', 3, 1],
      ['d', 1, 3],
      ['a', 0, 4],
    ])
  })
})
