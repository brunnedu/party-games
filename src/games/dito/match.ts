// What the phone can tell about two answers. The database decides which answers
// are identical; the hints for plurals and typos are only suggestions.

const IGNORED = /(\s|['’`´!"#$%&()*+,./:;<=>?@[\]\\^_{|}~«»‹›„“”‚‘…–—¡¿-])+/g

/** Keep in sync with private.dito_normalize. */
export function normalize(text: string): string {
  const folded = text
    .normalize('NFC')
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .replaceAll('ẞ', 'ss')
    .replace(IGNORED, '')
  return folded || text.trim()
}

const PLURAL_ENDINGS = ['e', 'n', 'en', 'er', 's', 'se', 'nen']

const withoutUmlauts = (text: string) =>
  text.replaceAll('ä', 'a').replaceAll('ö', 'o').replaceAll('ü', 'u')

/** Typed letters to add, drop, change or swap to get from a to b. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1)
      }
      rows[i]![j] = best
    }
  }
  return rows[a.length]![b.length]!
}

/**
 * Not identical, but maybe a plural or a typo. This can be wrong ("Haus" and
 * "Maus"), so such an answer is only highlighted.
 */
export function looksSimilar(first: string, second: string): boolean {
  const a = normalize(first)
  const b = normalize(second)
  if (a === b) return false
  const [short, long] = [withoutUmlauts(a), withoutUmlauts(b)].sort(
    (x, y) => x.length - y.length,
  ) as [string, string]
  if (short === long) return true
  if (short.length >= 3 && PLURAL_ENDINGS.some((ending) => long === short + ending)) return true
  if (short.length < 4) return false
  return distance(a, b) <= (short.length >= 8 ? 2 : 1)
}

/** Answers may have two words; names and sayings may have more. */
export const isLong = (answer: string) => answer.trim().split(/\s+/).length > 2
