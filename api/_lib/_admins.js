// Who to tell, when something needs a human.
//
// Extracted because two functions now need it and a second copy is a second
// place to forget that `admins.email` is only the bootstrap address. A row can
// be bound to a user_id with no email column set at all — admins.sql backfills
// user_id on every run and never writes the address back — so auth.users is the
// truth once a row is bound, and the column is the fallback rather than the
// other way round.
//
// Takes a service-key client. There is no RLS escape here: `admins` is readable
// only by admins, and auth.admin.getUserById is a service-role call.

export async function adminEmails(supabase) {
  const { data: admins, error } = await supabase
    .from('admins').select('user_id, email').is('revoked_at', null)

  if (error) {
    console.error('Admin lookup failed:', error.message)
    return []
  }

  const out = []
  for (const admin of admins || []) {
    let to = admin.email
    if (admin.user_id) {
      const { data } = await supabase.auth.admin.getUserById(admin.user_id)
      to = data?.user?.email || to
    }
    if (to && !out.includes(to)) out.push(to)
  }
  return out
}
