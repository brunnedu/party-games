// What the screens work out from a snapshot.
import type { ClueSet, Game, Team } from './api'

export const idsOf = (game: Game, team: Team) => (team === 0 ? game.red_ids : game.blue_ids)

export const encryptorOf = (game: Game, team: Team) =>
  team === 0 ? game.red_encryptor : game.blue_encryptor

export const submittedBy = (game: Game, team: Team) =>
  team === 0 ? game.red_submitted : game.blue_submitted

export function teamOf(game: Game, userId: string): Team | null {
  if (game.red_ids.includes(userId)) return 0
  return game.blue_ids.includes(userId) ? 1 : null
}

/** Whether this team has to guess the code of the current turn. */
export const teamGuesses = (game: Game, team: Team) =>
  team === game.turn || game.round_no > 1

/** Everyone in a guessing team, except the clue-giver for their own code. */
export function mayGuess(game: Game, userId: string): boolean {
  const team = teamOf(game, userId)
  if (team === null || !teamGuesses(game, team)) return false
  return !(team === game.turn && encryptorOf(game, team) === userId)
}

/** Whether this team's clues of the current round are on the table. */
export const isRevealed = (game: Game, history: ClueSet[], team: Team) =>
  history.some((h) => h.round_no === game.round_no && h.team === team)

export interface NoteEntry {
  round_no: number
  clue: string
}

/**
 * The note sheet: one team's clues, sorted by the number they stood for. Only
 * sets whose code is out.
 */
export function noteSheet(history: ClueSet[], team: Team): NoteEntry[][] {
  const columns: NoteEntry[][] = [[], [], [], []]
  for (const set of history) {
    if (set.team !== team || !set.code) continue
    set.code.forEach((digit, i) => {
      columns[digit - 1]?.push({ round_no: set.round_no, clue: set.clues[i] ?? '' })
    })
  }
  return columns
}
