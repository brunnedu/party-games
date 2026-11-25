// localStorage is shared by everything on the same origin (e.g. a portfolio on
// <user>.github.io), so all keys carry a prefix.
//
// Development only: open http://localhost:5173/party-games/?player=2 to get a
// separate player in the same browser.
const devPlayer = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('player')
  : null

export function storageKey(name: string): string {
  return devPlayer ? `party-games:${devPlayer}:${name}` : `party-games:${name}`
}

export function load(name: string): string {
  try {
    return localStorage.getItem(storageKey(name)) ?? ''
  } catch {
    return ''
  }
}

export function save(name: string, value: string): void {
  try {
    localStorage.setItem(storageKey(name), value)
  } catch {
    // Private mode or blocked storage: the app still works for this visit.
  }
}
