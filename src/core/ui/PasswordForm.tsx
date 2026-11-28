import { useState, type FormEvent } from 'react'
import { roomApi } from '../room/api'
import { t } from '../strings.de'
import { ErrorMessage } from './components'
import { useAction } from './useAction'

/** Asks for the site password. The database checks it and remembers this browser. */
export function PasswordForm({
  onUnlocked,
  onBack,
  invalidInvite,
}: {
  /** Runs after the right password, e.g. what needed it in the first place. */
  onUnlocked: () => unknown
  onBack?: () => void
  invalidInvite?: boolean
}) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(async () => {
      await roomApi.unlock(password)
      await onUnlocked()
    })
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{t.passwordTitle}</h2>
      <p className="muted">{invalidInvite ? t.inviteInvalid : t.passwordHelp}</p>
      <label>
        {t.password}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoCapitalize="none"
          maxLength={72}
          required
        />
      </label>
      <button className="button" disabled={busy || !password.trim()}>
        {t.unlock}
      </button>
      {onBack && (
        <button type="button" className="link-button" onClick={onBack}>
          {t.dialogBack}
        </button>
      )}
      <ErrorMessage>{error}</ErrorMessage>
      <p className="muted notice">{t.accessNotice}</p>
    </form>
  )
}
