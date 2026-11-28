import { describe, expect, it } from 'vitest'
import type { ClueSet, Game } from './api'
import { mayGuess, noteSheet } from './table'

const game = {
  turn: 0,
  round_no: 1,
  red_ids: ['a', 'b'],
  blue_ids: ['c', 'd'],
  red_encryptor: 'a',
  blue_encryptor: 'c',
} as Game

const allowed = (g: Game) => ['a', 'b', 'c', 'd'].filter((id) => mayGuess(g, id))

describe('who may guess', () => {
  it('is only the own team in round 1, without the clue-giver', () => {
    expect(allowed(game)).toEqual(['b'])
    expect(allowed({ ...game, turn: 1 })).toEqual(['d'])
  })

  it('includes the whole other team from round 2', () => {
    expect(allowed({ ...game, round_no: 2 })).toEqual(['b', 'c', 'd'])
  })
})

describe('note sheet', () => {
  const set = (round_no: number, team: 0 | 1, clues: string[], code: number[] | null) =>
    ({ round_no, team, clues, code, own_guess: null, other_guess: null }) as ClueSet

  it('sorts one team’s clues by number, once the code is out', () => {
    const history = [
      set(1, 0, ['x', 'y', 'z'], [4, 2, 1]),
      set(1, 1, ['not', 'this', 'team'], [1, 2, 3]),
      set(2, 0, ['u', 'v', 'w'], [2, 3, 4]),
      set(3, 0, ['still', 'secret', 'code'], null),
    ]
    expect(noteSheet(history, 0).map((column) => column.map((e) => e.clue))).toEqual([
      ['z'], ['y', 'u'], ['v'], ['x', 'w'],
    ])
  })
})
