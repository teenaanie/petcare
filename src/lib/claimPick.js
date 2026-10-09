// The listing somebody chose before they signed in.
//
// The /business page lets a business look itself up without an account, which
// is the point: you should not have to make an account to find out whether you
// already have a listing. But the claim happens on the other side of a
// six-digit code, and asking them to search for the same business a second
// time there is the kind of small forgetting that makes a product feel like a
// form.
//
// sessionStorage, deliberately, and it carries a NAME and an id — not
// permission. Nothing is claimed by remembering it: the claim is still a
// signed-in call to claim_provider(), which checks who is asking and writes a
// row an admin has to approve. The worst a tampered value can do is put the
// wrong name in a search box.
//
// Read ONCE, then cleared: somebody who comes back a week later for a second
// business must not find the first one waiting to be claimed by accident.

const KEY = 'pippy_provider_claim_pick'

export function rememberClaimPick(provider) {
  if (!provider?.id || !provider?.name) return
  try { sessionStorage.setItem(KEY, JSON.stringify({ id: provider.id, name: provider.name })) }
  catch { /* a private window still gets the sign-in link */ }
}

/** What they picked, if anything — and it is forgotten by asking. */
export function takeClaimPick() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const pick = JSON.parse(raw)
    return pick?.name ? pick : null
  } catch { return null }
}
