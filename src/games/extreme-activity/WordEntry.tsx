import { useState, type FormEvent } from 'react'
import type { Player } from '../../core/room/api'
import { useConfirm } from '../../core/ui/ConfirmDialog'
import { activityApi, type Snapshot } from './api'
import { MaxWordsChoice } from './Settings'
import { s } from './strings.de'

function WordForm({
  title,
  max,
  askName,
  busy,
  onSave,
  onCancel,
}: {
  title: string
  max: number
  askName: boolean
  busy: boolean
  onSave: (words: string[], name: string | null) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState('')
  const [words, setWords] = useState<string[]>([])
  const filled = Array.from({ length: max }, (_, i) => words[i]?.trim() ?? '').filter(Boolean)

  function submit(e: FormEvent) {
    e.preventDefault()
    onSave(filled, askName ? name : null)
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{title}</h2>
      <p className="muted">{s.writeHelp(max)}</p>
      {askName && (
        <label>
          {s.yourName}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="off"
            required
          />
        </label>
      )}
      {Array.from({ length: max }, (_, i) => (
        <input
          key={i}
          aria-label={s.wordLabel(i + 1)}
          placeholder={i === 0 ? s.wordLabel(1) : `${s.wordLabel(i + 1)} (${s.optional})`}
          value={words[i] ?? ''}
          onChange={(e) => {
            const next = [...words]
            next[i] = e.target.value
            setWords(next)
          }}
          maxLength={40}
          autoComplete="off"
        />
      ))}
      <button className="button" disabled={busy || filled.length === 0}>
        {s.save}
      </button>
      {onCancel && (
        <button type="button" className="link-button" onClick={onCancel}>
          {s.cancel}
        </button>
      )}
    </form>
  )
}

/**
 * Everyone writes on their own phone, or borrows one. Saved words are never
 * shown again, so the phone can be passed on.
 */
export function WordEntry({
  roomId,
  snapshot,
  players,
  ownName,
  isHost,
  busy,
  run,
}: {
  roomId: string
  snapshot: Snapshot
  players: Player[]
  ownName: string
  isHost: boolean
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<void>
}) {
  const [guest, setGuest] = useState(false)
  // Raised after saving, so the next person starts with an empty form.
  const [formNo, setFormNo] = useState(0)
  const confirm = useConfirm()
  const { writers, words_total, max_words, own_submitted } = snapshot
  const missing = players
    .filter((p) => !writers.some((w) => w.name.toLowerCase() === p.name.toLowerCase()))
    .map((p) => p.name)
    .join(', ')
  const writing = guest || !own_submitted

  function save(words: string[], name: string | null) {
    void run(async () => {
      await activityApi.submit(roomId, words, name)
      setGuest(false)
      setFormNo((n) => n + 1)
    })
  }

  return (
    <>
      {writing ? (
        <WordForm
          key={`${guest}:${formNo}`}
          title={guest ? s.writeTitleFor : `${s.writeTitle}, ${ownName}`}
          max={max_words}
          askName={guest}
          busy={busy}
          onSave={save}
          onCancel={guest ? () => setGuest(false) : undefined}
        />
      ) : (
        <section className="card center stack">
          <h2>{s.saved}</h2>
          <button className="button secondary" onClick={() => setGuest(true)}>
            {s.nextPerson}
          </button>
        </section>
      )}

      <section className="card stack">
        <h2>{s.total(words_total, writers.length)}</h2>
        <p className="muted">{s.target}</p>
        {writers.length > 0 && (
          <ul className="writer-list">
            {writers.map((w) => (
              <li key={w.name}>{s.writerCount(w.name, w.count)}</li>
            ))}
          </ul>
        )}
        {missing && <p className="muted">{s.missing(missing)}</p>}
        {isHost && !guest && (
          <>
            <button
              className="button"
              disabled={busy || words_total === 0}
              onClick={() =>
                confirm.ask(s.confirmPlay(words_total, missing), () =>
                  void run(() => activityApi.play(roomId)),
                )
              }
            >
              {s.startPlaying}
            </button>
            <MaxWordsChoice
              value={max_words}
              disabled={busy}
              onChange={(n) => void run(() => activityApi.setMaxWords(roomId, n))}
            />
          </>
        )}
        {!isHost && <p className="muted center">{s.waitingForPlay}</p>}
      </section>
      {confirm.dialog}
    </>
  )
}
