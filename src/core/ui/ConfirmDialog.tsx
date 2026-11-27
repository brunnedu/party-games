// Our own confirmation dialog. window.confirm looks foreign, and iOS Safari can
// silently suppress it, which the app can't tell apart from "Cancel".
import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../strings.de'

export interface Confirmation {
  title: string
  text: string
  /** Names the action, e.g. "Entfernen". */
  confirmLabel: string
}

// Taps right after opening are ignored, so that a double tap on the button that
// opened the dialog neither confirms nor closes it.
const TAP_GUARD_MS = 350

function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
}: Confirmation & { onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const openedAt = useRef(0)
  const id = useId()

  useEffect(() => {
    const element = dialog.current!
    openedAt.current = performance.now()
    element.showModal()
    // The harmless choice is the default.
    back.current?.focus()
    return () => element.close()
  }, [])

  const tap = (action: () => void) => () => {
    if (performance.now() - openedAt.current >= TAP_GUARD_MS) action()
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      // Escape.
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      // In case the browser closes it on its own.
      onClose={(e) => {
        if (!e.currentTarget.open) onCancel()
      }}
      // The content fills the dialog, so only the backdrop hits the element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) tap(onCancel)()
      }}
    >
      <div className="confirm-body">
        <h2 id={`${id}-title`}>{title}</h2>
        <p id={`${id}-text`}>{text}</p>
        <button type="button" className="button" onClick={tap(onConfirm)}>
          {confirmLabel}
        </button>
        <button ref={back} type="button" className="button secondary" onClick={tap(onCancel)}>
          {t.dialogBack}
        </button>
      </div>
    </dialog>
  )
}

/**
 * Asks before running an action. Render `dialog` anywhere in the component; the
 * question disappears with the component. When `scope` changes (say, a new
 * round), an open question is outdated and closes too.
 */
export function useConfirm(scope = '') {
  const [pending, setPending] = useState<{
    confirmation: Confirmation
    onConfirm: () => void
    scope: string
  }>()
  const current = pending?.scope === scope ? pending : undefined
  // Forget it, so that it can't come back if the scope returns.
  if (pending && !current) setPending(undefined)

  function ask(confirmation: Confirmation, onConfirm: () => void) {
    setPending({ confirmation, onConfirm, scope })
  }

  const dialog = current ? (
    <ConfirmDialog
      {...current.confirmation}
      onCancel={() => setPending(undefined)}
      onConfirm={() => {
        setPending(undefined)
        current.onConfirm()
      }}
    />
  ) : null

  return { ask, dialog }
}
