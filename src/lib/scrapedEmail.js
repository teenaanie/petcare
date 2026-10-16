// Choosing one email address from what a scrape found on a business's website.
//
// The Google Maps scrape, run with contact enrichment, returns an `emails`
// array: every address it found on whatever page it reached. That is not the
// same as the business's address. Across the 65 providers where the Pune
// scrapes found one, the array contained:
//
//   · the business's own address          info@tailsofthecity.in
//   · a website builder's placeholder     info@mysite.com   (Wix's default)
//   · a listing platform's support desk   care@magicpin.in, support@xirify.com
//   · a different company's address       info@pawsy.com on a cat boarder
//   · the same address twice, cased       support@zigly.com, support@Zigly.com
//   · somebody unrelated                  amitubale22@gmail.com beside the owner's
//
// Writing to the wrong one is worse than writing to nobody: a "claim your
// listing" letter to a platform's support desk is noise to them, and a letter
// to an unrelated person is a stranger emailing a stranger about a business
// that is not theirs.

/**
 * Domains that are never the business.
 *
 * Placeholders a site template ships with, and the platforms whose contact
 * page the scraper reached instead of the business's own. Each of these was
 * observed in the real data, not guessed.
 */
const NOT_THE_BUSINESS = new Set([
  'mysite.com',        // Wix's default template address
  'example.com', 'example.org', 'domain.com', 'yourdomain.com', 'email.com',
  'magicpin.in', 'xirify.com', 'pawsy.com',
  'justdial.com', 'sulekha.com', 'indiamart.com', 'tradeindia.com',
  'zomato.com', 'swiggy.in', 'practo.com', 'urbancompany.com', 'urbanclap.com',
  'wixpress.com', 'sentry.io', 'wordpress.com', 'squarespace.com',
  'godaddy.com', 'shopify.com', 'bigrock.in', 'hostinger.com', 'namecheap.com',
])

const SHAPE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/

// Mailboxes that belong to a department, not to whoever answers the business.
// Heads Up For Tails publishes hireme@, hello@, grc@ and wecare@ on one page;
// a letter about claiming a listing wants the front door, not recruitment.
const BACK_OFFICE = /^(hireme|hiring|careers?|jobs|recruit\w*|hr|grc|legal|compliance|press|media|investor\w*|billing|accounts?|invoice\w*|noreply|no-reply|donotreply|abuse|postmaster|webmaster|privacy|dpo|unsubscribe)$/
const FRONT_DOOR  = /^(hello|hi|info|contact|enquiry|enquiries|inquiry|inquiries|care|wecare|support|help|admin|office|reception|book|bookings|sales|team|mail)$/

const domainOf = v => {
  const m = String(v || '').toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([^/:?#]+)/)
  return m ? m[1] : null
}

/** Words in a business name worth matching an address against. */
const nameWords = name => String(name || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  // Short and generic words match everything and prove nothing: "pet" would
  // make petfixveterinaryclinic@ and petceteraclinic@ equally good for any
  // business with "pet" in its name.
  .filter(w => w.length >= 4 && !['pet','pets','dog','dogs','cat','cats','the','and','clinic','centre','center','care','shop','store','services','service','veterinary'].includes(w))

/**
 * One address, or null.
 *
 * @param record  the scraped row: { emails, website, title }
 */
export function pickEmail(record) {
  const raw = Array.isArray(record?.emails) ? record.emails : []

  // Normalise and drop what cannot be an address, or is never the business.
  const seen = new Set()
  const candidates = []
  for (const e of raw) {
    const v = String(e || '').trim().toLowerCase()
    if (!SHAPE.test(v)) continue
    const d = v.split('@')[1]
    if (NOT_THE_BUSINESS.has(d)) continue
    if (seen.has(v)) continue          // "support@zigly.com" and "support@Zigly.com"
    seen.add(v)
    candidates.push(v)
  }
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]

  const local = c => c.split('@')[0]
  const bare  = c => local(c).replace(/[^a-z0-9]/g, '')
  // Within an equally good set, take the front door before anything else, and
  // never a back-office mailbox if something else is on offer.
  const best = list => {
    if (list.length <= 1) return list[0]
    return list.find(c => FRONT_DOOR.test(local(c)))
        ?? list.find(c => !BACK_OFFICE.test(local(c)))
        ?? list[0]
  }

  // 1. An address on the business's own domain is the business's address.
  const site = domainOf(record?.website)
  if (site) {
    const onSite = candidates.filter(c => c.split('@')[1] === site)
    if (onSite.length) return best(onSite)
  }

  // 2. Otherwise the one that says the business's name. This is what separates
  //    meowbnb.pune@gmail.com from info@pawsy.com, and the owner's address
  //    from the unrelated one beside it.
  //    The name can echo in either half: meowbnb.pune@gmail.com puts it in the
  //    local part, dramey@auravet.in puts it in the domain.
  const words = nameWords(record?.title)
  if (words.length) {
    const named = candidates.filter(c =>
      words.some(w => bare(c).includes(w) || c.split('@')[1].replace(/[^a-z0-9]/g, '').includes(w)))
    if (named.length) return best(named)
  }

  // 3. Nothing distinguishes them. Front door first, then the first that is
  //    not a back-office mailbox, and let a human look.
  return best(candidates)
}
