// Where a round's points come from. The database does the scoring; this only
// explains it, from what everyone can see once the reveal is complete.
// A test compares the totals with private.walter_award.
import type { Reveal } from './api'

export interface Breakdown {
  /** For picking the truth. */
  truth: number
  /** For votes on one's own fake. */
  fake: number
  /** As the Sphinx, for votes that found the truth. */
  sphinx: number
}

export function pointsBreakdown(
  reveals: Reveal[],
  sphinxId: string,
  sphinxFoul: boolean,
): Record<string, Breakdown> {
  const result: Record<string, Breakdown> = {}
  const add = (id: string, kind: keyof Breakdown, points: number) => {
    if (points === 0) return
    result[id] ??= { truth: 0, fake: 0, sphinx: 0 }
    result[id][kind] += points
  }

  for (const { entries, votes, is_truth } of reveals) {
    // Matching answers are revealed together; their writers get nothing for them.
    const matched = entries.length > 1
    if (is_truth) {
      for (const vote of votes) add(vote.voter_id, 'truth', 1)
      if (!matched && !sphinxFoul) add(sphinxId, 'sphinx', votes.length)
    } else if (!matched) {
      const author = entries[0]?.player_id
      if (author) add(author, 'fake', votes.length)
    }
  }
  return result
}
