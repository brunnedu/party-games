import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../strings.de'

export function Page({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="page">
      <header className="page-header">
        <Link to="/" className="home-link" aria-label={t.back}>
          🎲 {t.appName}
        </Link>
      </header>
      {title && <h1>{title}</h1>}
      {children}
    </main>
  )
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return children ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : null
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <Page>
      <div className="card center">
        <p>{children}</p>
        <Link to="/" className="button secondary">
          {t.back}
        </Link>
      </div>
    </Page>
  )
}
