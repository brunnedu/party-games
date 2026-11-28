import type { GameViewProps } from '../../core/game'
import { useQuery } from '../../core/room/useQuery'
import { errorText } from '../../core/rpc'
import { t } from '../../core/strings.de'
import { ErrorMessage } from '../../core/ui/components'
import { useAction } from '../../core/ui/useAction'
import { wavelengthApi } from './api'
import { s } from './strings.de'

/** Cooperative or competitive. The host chooses, everyone sees. */
export function WavelengthLobbySettings({ room, userId, refresh }: GameViewProps) {
  const query = useQuery(() => wavelengthApi.lobby(room.id), `${room.id}:${room.version}`)
  const { busy, error, run } = useAction(async () => {
    await Promise.all([refresh(), query.refresh()])
  })
  const setup = query.data
  if (!setup) {
    return (
      <p className="muted center">{query.error ? errorText(query.error) : t.loading}</p>
    )
  }
  const current = setup.competitive ? 'competitive' : 'cooperative'

  return (
    <section className="card stack">
      <h2 id="variant-label">{s.variantTitle}</h2>
      <div className="tabs" role="group" aria-labelledby="variant-label">
        {(['cooperative', 'competitive'] as const).map((variant) => (
          <button
            key={variant}
            type="button"
            aria-pressed={current === variant}
            disabled={busy || room.host_id !== userId}
            onClick={() =>
              void run(() => wavelengthApi.setCompetitive(room.id, variant === 'competitive'))
            }
          >
            {s.variants[variant]}
          </button>
        ))}
      </div>
      <p className="muted">{s.variantHelp[current]}</p>
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  )
}
