// How people get into a room: the QR code and the join link. Both carry the
// room's invite, so that guests don't need the site password.
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { roomApi, type Room } from '../room/api'
import { useQuery } from '../room/useQuery'
import { t } from '../strings.de'

export function joinLink(code: string, invite = '') {
  const query = invite ? `?k=${encodeURIComponent(invite)}` : ''
  // Everything after "#" stays in the browser; the web host never sees it.
  return `${window.location.origin}${import.meta.env.BASE_URL}#/join/${code}${query}`
}

export function Invite({ room }: { room: Room }) {
  // Re-loaded on every change: removing someone replaces the invite.
  const query = useQuery(() => roomApi.invite(room.id), `${room.id}:${room.version}`)
  const [copied, setCopied] = useState('')

  // If the invite can't be loaded, the plain link still works with the password.
  if (query.data === undefined && !query.error) return <p className="muted">{t.loading}</p>
  const link = joinLink(room.code, query.data)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(link)
    } catch {
      window.prompt(t.copyLink, link)
    }
  }

  return (
    <div className="invite">
      <div className="qr">
        <QRCodeSVG value={link} size={200} marginSize={2} />
      </div>
      <button type="button" className="button secondary" onClick={copy}>
        {copied === link ? t.copied : t.copyLink}
      </button>
    </div>
  )
}

/** Shown between rounds, when new players may join. */
export function InviteBanner({ room, text }: { room: Room; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="banner center">
      <p>{text}</p>
      <button
        type="button"
        className="button secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? t.hideInvite : t.invite}
      </button>
      {open && <Invite room={room} />}
    </div>
  )
}
