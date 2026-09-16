// netlify/functions/_redact.js
// Masking for anything that reaches a log line, an HTTP response, or a stored
// run record.
//
// Platform logs are not a private place: Vercel retains them and everyone with
// project access can read them. A log line saying a reminder went out is useful
// for debugging; the address it went to is not, and keeping it turns the log
// into a copy of the user table.
//
// These are one-way. They exist to make a line identifiable-to-you, not
// reversible-by-anyone.

/** te***@example.com — enough to recognise an address you already know. */
export function maskEmail(email) {
  const s = String(email || '')
  const at = s.indexOf('@')
  if (at < 1) return s ? '[redacted]' : ''
  const local  = s.slice(0, at)
  const domain = s.slice(at)
  const keep   = local.length <= 2 ? 1 : 2
  return local.slice(0, keep) + '***' + domain
}

/** +9198•••••21 — country code and last two digits. */
export function maskPhone(phone) {
  const s = String(phone || '').replace(/\s+/g, '')
  if (!s) return ''
  if (s.length <= 4) return '***'
  return s.slice(0, 4) + '•'.repeat(Math.max(3, s.length - 6)) + s.slice(-2)
}

/**
 * Message bodies are never logged. A reminder's text carries the pet's name,
 * what it is being treated for and when — the most sensitive thing this app
 * holds. Log its length instead, which is all a delivery bug needs.
 */
export function bodyShape(body) {
  return `${String(body || '').length} chars`
}
