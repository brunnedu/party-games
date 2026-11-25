import { describe, expect, it } from 'vitest'
import { cardSlots } from './cardSlots'

const game = (phase: Parameters<typeof cardSlots>[0]['phase'], round_no: number) => ({
  phase,
  round_no,
  cards_total: 13,
})

describe('cardSlots', () => {
  it('marks the first card as current', () => {
    const slots = cardSlots(game('choosing_word', 1), [])
    expect(slots).toHaveLength(13)
    expect(slots.slice(0, 2)).toEqual(['current', 'open'])
  })

  it('shows the lost card after a wrong guess', () => {
    const history = [
      { round_no: 1, result: 'correct' as const },
      { round_no: 2, result: 'wrong' as const },
      { round_no: 3, result: 'pass' as const },
    ]
    expect(cardSlots(game('writing_clues', 4), history).slice(0, 6)).toEqual([
      'correct', 'wrong', 'lost', 'pass', 'current', 'open',
    ])
  })

  it('shows the running result without a penalty yet', () => {
    const history = [{ round_no: 1, result: 'wrong' as const }]
    expect(cardSlots(game('round_result', 1), history).slice(0, 2)).toEqual(['wrong', 'open'])
  })

  it('never exceeds the number of cards', () => {
    const history = Array.from({ length: 13 }, (_, i) => ({
      round_no: i + 1,
      result: i === 12 ? ('wrong' as const) : ('correct' as const),
    }))
    const slots = cardSlots(game('game_over', 13), history)
    expect(slots).toHaveLength(13)
    expect(slots.at(-1)).toBe('wrong')
  })
})
