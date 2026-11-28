import { describe, expect, it } from 'vitest'
import { isLong, looksSimilar, normalize } from './match'
import { finalRanking } from './scoring'

describe('identical answers', () => {
  it('ignore capitals, punctuation, spaces and ß', () => {
    expect(normalize('Fußball')).toBe(normalize('fuss-ball!'))
    expect(normalize('...')).toBe('...')
    expect(normalize('Apfel')).not.toBe(normalize('Äpfel'))
  })
})

describe('hints for plurals and typos', () => {
  it.each([
    ['Hund', 'Hunde'], ['Katze', 'Katzen'], ['Apfel', 'Äpfel'], ['Haus', 'Häuser'],
    ['Auto', 'Autos'], ['Lehrerin', 'Lehrerinnen'], ['Banane', 'Bannane'],
    ['Gitarre', 'Gitare'], ['Fahrrad', 'Farhrad'], ['Staubsauger', 'Staupsauger'],
  ])('highlights %s and %s', (a, b) => {
    expect(looksSimilar(a, b)).toBe(true)
    expect(looksSimilar(b, a)).toBe(true)
  })

  it.each([
    ['Geige', 'Violine'], ['Instrument', 'Geige'], ['Ei', 'Eis'], ['Bus', 'Bett'],
    ['Apfel', 'apfel!'],
  ])('leaves %s and %s alone', (a, b) => {
    expect(looksSimilar(a, b)).toBe(false)
  })

  it('warns from the third word on', () => {
    expect(isLong(' Erste  Hilfe ')).toBe(false)
    expect(isLong('Der Herr der Ringe')).toBe(true)
  })
})

describe('final ranking', () => {
  const players = ['a', 'b', 'c', 'd'].map((user_id) => ({ user_id }))

  it('breaks ties by the best single round, then shares the place', () => {
    const ranked = finalRanking(players, {
      a: { score: 20, best_round: 8 },
      b: { score: 20, best_round: 11 },
      c: { score: 20, best_round: 8 },
      d: { score: 5, best_round: 5 },
    })
    expect(ranked.map((r) => [r.player.user_id, r.rank])).toEqual([
      ['b', 1], ['a', 2], ['c', 2], ['d', 4],
    ])
  })
})
