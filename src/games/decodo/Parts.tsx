// Pieces used on several screens: tokens, the secret words and the note sheet.
import { useState } from 'react'
import { useHold } from '../../core/ui/useHold'
import { TEAMS, type ClueSet, type Game, type Team } from './api'
import { s } from './strings.de'
import { noteSheet } from './table'

export const teamClass = (team: Team) => (team === 0 ? 'decodo-red' : 'decodo-blue')
export const teamName = (team: Team) => s.teamNames[team]

export function Tokens({ game, own }: { game: Game; own: Team | null }) {
  const dots = (label: string, n: number, kind: 'good' | 'bad') => (
    <span className="decodo-token-row" role="img" aria-label={s.tokens(label, n)}>
      <span aria-hidden>{label}</span>
      {[0, 1].map((i) => (
        <span key={i} aria-hidden className={i < n ? `decodo-token ${kind}` : 'decodo-token'} />
      ))}
    </span>
  )
  return (
    <div className="decodo-tokens">
      {TEAMS.map((team) => (
        <section
          key={team}
          className={`card ${teamClass(team)}${team === own ? ' own' : ''}`}
        >
          <strong>{s.team(teamName(team))}</strong>
          {dots(s.interceptions, game.interceptions[team], 'good')}
          {dots(s.misses, game.misses[team], 'bad')}
        </section>
      ))}
    </div>
  )
}

/** The team's four words, only on screen while the card is held down. */
export function SecretWords({ words, team }: { words: string[]; team: Team }) {
  const { held, holdProps } = useHold()
  return (
    <button
      type="button"
      className={`card center secret decodo-words hold-button ${teamClass(team)}`}
      {...holdProps}
    >
      {held ? (
        <span className="decodo-word-list">
          {words.map((word, i) => (
            <span key={word}>
              <span className="decodo-digit">{i + 1}</span>
              <span className="decodo-word">{word}</span>
            </span>
          ))}
        </span>
      ) : (
        <>
          <strong>{s.holdWords}</strong>
          <span className="muted">{s.holdWarning}</span>
        </>
      )}
    </button>
  )
}

/** Both teams' clues so far, one team at a time, in four columns by number. */
export function NoteSheet({
  history,
  initial,
  words,
}: {
  history: ClueSet[]
  initial: Team
  /** Shown as headings once they are no longer secret. */
  words?: [string[], string[]] | null
}) {
  const [team, setTeam] = useState<Team>(initial)
  return (
    <section className="card stack">
      <h2>{s.notes}</h2>
      <p className="muted">{s.notesHelp}</p>
      <div className="tabs">
        {TEAMS.map((id) => (
          <button key={id} type="button" aria-pressed={team === id} onClick={() => setTeam(id)}>
            {s.team(teamName(id))}
          </button>
        ))}
      </div>
      <div className={`decodo-notes ${teamClass(team)}`} aria-label={s.notesOf(teamName(team))}>
        {noteSheet(history, team).map((column, i) => (
          <div key={i}>
            <h3>
              <span className="decodo-digit">{i + 1}</span>
              {words?.[team][i]}
            </h3>
            {column.length === 0 ? (
              <p className="muted">{s.nothingYet}</p>
            ) : (
              <ul>
                {column.map((entry) => (
                  <li key={entry.round_no}>
                    <span className="muted">{s.roundShort(entry.round_no)}</span> {entry.clue}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
