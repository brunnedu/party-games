import { describe, expect, it } from 'vitest'
import { countFaces, previousPlayer, standings, totalDice } from './table'

const game = {
  order_ids: ['a', 'b', 'c', 'd'],
  dice_counts: { a: 2, b: 0, c: 3, d: 0 },
  eliminated_ids: ['d', 'b'],
}

describe('table helpers', () => {
  it('finds the previous player with dice, wrapping around', () => {
    expect(previousPlayer(game, 'c')).toBe('a')
    expect(previousPlayer(game, 'a')).toBe('c')
    expect(previousPlayer(game, 'x')).toBeUndefined()
  })

  it('counts dice and faces', () => {
    expect(totalDice(game)).toBe(5)
    expect(countFaces({ a: [1, 4], c: [4, 4, 6] })).toEqual([1, 0, 0, 3, 0, 1])
  })

  it('ranks the survivors first, then the last one out', () => {
    expect(standings(game)).toEqual(['c', 'a', 'b', 'd'])
  })
})
