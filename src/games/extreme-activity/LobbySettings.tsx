import type { GameViewProps } from '../../core/game'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { useAction } from '../../core/ui/useAction'
import { activityApi } from './api'
import { MaxWordsChoice, PhoneChoice } from './Settings'
import { s } from './strings.de'
import './extreme-activity.css'

/** The game phone and the number of words. The host edits, everyone sees. */
export function ActivityLobbySettings({ room, players, userId, refresh }: GameViewProps) {
  const query = useQuery(
    () => activityApi.lobby(room.id),
    `${room.id}:${room.version}:${players.length}`,
  )
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const setup = query.data
  if (!setup) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }
  const disabled = busy || room.host_id !== userId

  return (
    <section className="card stack">
      <h2>{s.settingsTitle}</h2>
      <PhoneChoice
        players={players}
        phoneId={setup.phone_id}
        disabled={disabled}
        onChange={(id) => void run(() => activityApi.setPhone(room.id, id))}
      />
      <p className="muted">{s.gamePhoneHelp}</p>
      <MaxWordsChoice
        value={setup.max_words}
        disabled={disabled}
        onChange={(n) => void run(() => activityApi.setMaxWords(room.id, n))}
      />
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  )
}
