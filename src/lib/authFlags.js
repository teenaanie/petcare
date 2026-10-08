// Which ways in are actually open.
//
// Phone sign-in is switched off: sending an SMS code needs an SMS provider, and
// one is not configured. Showing the tab would offer a way in that cannot work
// — a code that never arrives reads as the app being broken, not as a setting
// being off.
//
// The phone flows themselves are LEFT IN PLACE in both sign-ins rather than
// deleted, because this is a configuration state and not a decision about the
// product. Turning it back on is this one line, plus an SMS provider in the
// Supabase dashboard.
//
// It lives here, shared, rather than in either component, because it was a
// local const in PhoneAuth and the provider sign-in built later never got the
// memo: /business offered a Phone tab for weeks that could only ever fail.
// One flag, both doors.
//
// One pet-parent account signs in by phone and has no email address on it
// (checked 2026-09-28: 1 of 15 users, last seen 25 August, one pet, no
// records). While this is false, that account cannot get in. Giving it an
// email address in the Supabase dashboard is the way to bring it across.
export const PHONE_LOGIN_ENABLED = false
