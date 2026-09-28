// src/lib/clipboard.js
//
// Copying text without lying about whether it worked.
//
// Five places called `navigator.clipboard.writeText(...)` and assumed it would
// succeed. It does not, often, and for reasons that have nothing to do with the
// user doing anything wrong:
//
//   - `navigator.clipboard` is UNDEFINED outside a secure context. Over plain
//     http the old code threw "Cannot read properties of undefined", an
//     unhandled rejection that (before friendlyError was corrected) was
//     reported to the user as their internet being down.
//   - Safari rejects the write unless the document is focused and the call sits
//     inside a real user gesture. An await before it is enough to lose that.
//   - A browser or policy can simply refuse clipboard permission.
//
// What happened then depended on the call site, and all four behaviours were
// wrong: HealthSummary, DocumentScanner and Boarding left an unhandled
// rejection and never showed their "Copied" state, so the button looked dead;
// EmergencyCard never reached its confirmation alert; and PetSharing swallowed
// the error with `.catch(() => {})` and then said "Copied!" regardless — the
// worst of the four, because the user pastes and finds the old clipboard.
//
// So: one function, a fallback for when the API is unavailable, and an honest
// boolean. It never throws.

/**
 * Copy `text`. Returns true only if it actually landed on the clipboard.
 * Callers show their "Copied" state on true and say something useful on false.
 */
export async function copyText(text) {
  const value = String(text ?? '')
  if (!value) return false

  // The modern path. Needs a secure context, focus, and permission.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall through — execCommand still works in several cases this does not.
    }
  }

  // The old path, kept because it covers plain http and a Safari window that
  // has lost focus. Deprecated, not dead, and the alternative here is failing.
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    // Off-screen rather than hidden: a display:none element cannot be selected,
    // and readOnly stops the keyboard appearing on a phone.
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, value.length)
    const ok = document.execCommand?.('copy') ?? false
    document.body.removeChild(ta)
    return !!ok
  } catch {
    return false
  }
}

/** What to tell someone when the copy did not work. */
export const COPY_FAILED =
  "Couldn't copy automatically — select the text and copy it by hand."
