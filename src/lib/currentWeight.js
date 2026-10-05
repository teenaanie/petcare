// What a pet weighs, and how much that figure can be trusted.
//
// ── Why this is not a one-line field read ───────────────────────────────────
//
// Pippy stores a pet's weight twice. `pets.weight` is a number typed into the
// profile form, with no date attached and no record of when it was true.
// `weight_logs` holds dated readings. Nothing has ever kept them in step.
//
// The result, measured on the live database: of the eleven pets with weight
// readings, NINE have a profile weight that disagrees with their latest
// reading. A customer noticed because her cat's card said 1.7 kg while the
// chart showed 2.6 kg.
//
// ── Why the obvious fix would have been dangerous ───────────────────────────
//
// The obvious fix is "the latest reading wins" -- a trigger, or a backfill.
// Two rows on the live data say no:
//
//   Hunter, a Labrador : profile 40 kg, latest reading 3.8 kg (24 Sep)
//   Poppy              : profile 6 kg,  latest reading 5 kg (6 Aug 2024)
//
// Hunter's reading looks like 38 typed as 3.8. Propagating it would print
// "3.8 kg" on the emergency card a vet reads to work out a dose. Poppy's
// reading is real but over two years old, so the profile figure is probably
// the better one. "Latest wins" is wrong in both, in opposite directions.
//
// So nothing here overwrites anything. The rules are:
//
//   1. Prefer the most recent DATED reading, because it is the only figure
//      with any provenance at all.
//   2. Always carry its date, so a two-year-old reading can be recognised as
//      one. An undated number presented as current is the actual bug.
//   3. When the profile figure materially disagrees, say so and let the owner
//      decide. Do not quietly pick a winner on their behalf.

/** Below this, a difference is an animal's normal fluctuation, not a conflict. */
const CONFLICT_FRACTION = 0.1

const n = (v) => {
  const x = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(x) && x > 0 ? x : null
}

/**
 * The weight to show, and where it came from.
 *
 * Reads `latestWeight` / `latestWeightOn`, which getPets() attaches from the
 * weight logs. Falls back to the profile figure when there are no readings, or
 * when a pet object came from somewhere that did not enrich it -- savePet()
 * returns a bare row, so this has to degrade rather than show nothing.
 *
 * @returns {{kg: number|null, on: string|null, measured: boolean}}
 *   `measured` is false when the number is the undated profile figure, which
 *   is what callers use to avoid presenting it as a measurement.
 */
export function currentWeight(pet = {}) {
  const logged = n(pet?.latestWeight)
  if (logged !== null) {
    return { kg: logged, on: pet.latestWeightOn || null, measured: true }
  }
  return { kg: n(pet?.weight), on: null, measured: false }
}

/**
 * Do the profile figure and the latest reading disagree enough to mention?
 *
 * Relative, not absolute: 0.2 kg is a rounding error on a 40 kg dog and a tenth
 * of a kitten. Returns null when there is nothing to report, so a caller can
 * use it directly as a condition.
 *
 * @returns {{profile: number, measured: number, on: string|null, fraction: number}|null}
 */
export function weightConflict(pet = {}) {
  const profile = n(pet?.weight)
  const measured = n(pet?.latestWeight)
  if (profile === null || measured === null) return null
  const fraction = Math.abs(measured - profile) / Math.max(measured, profile)
  if (fraction <= CONFLICT_FRACTION) return null
  return { profile, measured, on: pet.latestWeightOn || null, fraction }
}

/** "17.8 kg", or null when there is no usable figure. */
export function formatWeight(pet = {}) {
  const { kg } = currentWeight(pet)
  // Trim a trailing .0 so a whole number does not read as a precision claim.
  return kg === null ? null : `${Number(kg.toFixed(2))} kg`
}

/**
 * How a weight should read where there is room for its provenance: on a
 * handover sheet, or an emergency card a vet is looking at.
 */
export function describeWeight(pet = {}) {
  const { kg, on, measured } = currentWeight(pet)
  if (kg === null) return null
  const value = `${Number(kg.toFixed(2))} kg`
  if (!measured) return `${value} (from the profile, not measured)`
  if (!on) return value
  return `${value} (measured ${on})`
}
