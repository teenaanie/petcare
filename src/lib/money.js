// One place that knows what a rupee looks like.
//
// Written because two screens showed a rupee amount with a DOLLAR sign:
// a medical record's cost rendered as `· $2400` on the health timeline and
// again in the medical history list, while every other figure in the app —
// boarding totals, the provider's year, the admin's bill list — was already
// ₹ with Indian grouping. `medical_records` has no currency column, unlike
// `bills`, so that cost is rupees by construction and was simply mislabelled.
//
// Indian grouping, not the browser's default: 2,40,000 and not 240,000.

/** ₹ with Indian digit grouping. Paise are kept only when they exist. */
export function rupees(n) {
  // Before Number(), not after: Number(null) and Number('') are both 0, so a
  // record with NO cost would come back as "₹0" — a price that was never
  // charged, shown as if it had been. An absent cost must stay absent.
  if (n === null || n === undefined || n === '') return null
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return '₹' + v.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(v) ? 0 : 2,
  })
}

/**
 * Join the parts of a subtitle that actually exist.
 *
 * The bug this exists to stop: a line built by template literal prints the
 * string "undefined" for any field that is null, and `medical_records.type`
 * and `allergies.type` are both nullable. Every other field on those lines
 * was already guarded; the first one was not, because it had no separator in
 * front of it to hang a guard on.
 */
export const detailLine = (...parts) =>
  parts.filter(p => p !== null && p !== undefined && p !== '' && p !== false).join(' · ')
