import { useState, type FormEvent } from 'react'
import { load, save } from '../storage'
import { t } from '../strings.de'
import { ErrorMessage } from './components'
import { useAction } from './useAction'

/** Asks for a display name (remembered) and runs `onSubmit` with it. */
export function JoinForm({
  submitLabel,
  onSubmit,
  children,
  disabled,
}: {
  submitLabel: string
  onSubmit: (name: string) => Promise<unknown>
  children?: React.ReactNode
  disabled?: boolean
}) {
  const [name, setName] = useState(() => load('name'))
  const { busy, error, run } = useAction()

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    save('name', trimmed)
    void run(() => onSubmit(trimmed))
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <label>
        {t.yourName}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          autoComplete="nickname"
          required
        />
      </label>
      {children}
      <button className="button" disabled={busy || disabled || !name.trim()}>
        {submitLabel}
      </button>
      <ErrorMessage>{error}</ErrorMessage>
    </form>
  )
}
