import type { GameViewProps } from '../../core/game'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { Avatar } from '../../core/ui/Avatar'
import { ErrorMessage } from '../../core/ui/components'
import { useAction } from '../../core/ui/useAction'
import { decodoApi, otherTeam, TEAMS } from './api'
import { teamClass, teamName } from './Parts'
import { s } from './strings.de'
import '../../core/ui/game.css'
import './decodo.css'

/** The two teams. The host moves people, everyone sees. */
export function DecodoLobbySettings({ room, players, userId, refresh }: GameViewProps) {
  const query = useQuery(
    () => decodoApi.lobby(room.id),
    `${room.id}:${room.version}:${players.length}`,
  )
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const teams = query.data
  if (!teams) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }
  const isHost = room.host_id === userId

  return (
    <section className="card stack">
      <h2>{s.teamsTitle}</h2>
      <p className="muted">{s.teamsHelp}</p>
      {TEAMS.map((team) => (
        <div key={team} className={`decodo-team ${teamClass(team)}`}>
          <strong>{s.team(teamName(team))}</strong>
          <ul className="seat-list">
            {players
              .filter((p) => teams[p.user_id] === team)
              .map((p) => (
                <li key={p.user_id}>
                  <Avatar player={p} small />
                  <span className="player-name">{p.name}</span>
                  {isHost && (
                    <button
                      className="decodo-move"
                      aria-label={s.moveTo(p.name, teamName(otherTeam(team)))}
                      disabled={busy}
                      onClick={() =>
                        void run(() => decodoApi.setTeam(room.id, p.user_id, otherTeam(team)))
                      }
                    >
                      {s.move(teamName(otherTeam(team)))}
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="muted">{s.teamsRule}</p>
      {isHost && (
        <button
          className="button secondary"
          disabled={busy || players.length < 2}
          onClick={() => void run(() => decodoApi.shuffleTeams(room.id))}
        >
          {s.shuffle}
        </button>
      )}
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  )
}
