// The database does the scoring; this is only used to draw the areas.
// Keep in sync with private.wavelength_score. A test compares the two.

/** How far from the target (positions run 0-100) still earns how many points. */
export const BANDS = [
  { within: 4, points: 4 },
  { within: 11, points: 3 },
  { within: 18, points: 2 },
] as const

export const MAX_POINTS = 4

export function score(position: number, target: number): number {
  return BANDS.find((b) => Math.abs(position - target) <= b.within)?.points ?? 0
}
