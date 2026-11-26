import type { Player } from '../room/api'
import { t } from '../strings.de'
import { Avatar } from './Avatar'
import { ranking } from './ranking'
import './game.css'

export function Scoreboard({
  players,
  scores,
  userId,
}: {
  players: Player[]
  scores: Record<string, number>
  userId: string
}) {
  return (
    <ol className="player-list scoreboard">
      {ranking(players, scores).map(({ player, score, rank }) => (
        <li key={player.user_id}>
          <span className="rank">{rank}.</span>
          <Avatar player={player} small />
          <span className="player-name">{player.name}</span>
          {player.user_id === userId && <span className="tag">{t.you}</span>}
          <strong className="score">{score}</strong>
        </li>
      ))}
    </ol>
  )
}
