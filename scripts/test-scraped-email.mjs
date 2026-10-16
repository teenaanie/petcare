// Picking one email from what a scrape found on a business's website.
//
// Every case here is from the real data — the 65 Pune providers whose scrape
// carried an `emails` array. The array is whatever was on the page the
// scraper reached, which is often not the business.

import { pickEmail } from '../src/lib/scrapedEmail.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  if (got === want) { pass++; return }
  fail++
  console.log(`  FAIL ${label}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
const pick = (emails, title, website) => pickEmail({ emails, title, website })

// ── Nothing to pick ─────────────────────────────────────────────────────────
eq('no emails field',     pickEmail({ title: 'X' }), null)
eq('empty array',         pick([], 'X'), null)
eq('not an array',        pickEmail({ emails: 'a@b.com' }), null)
eq('malformed address',   pick(['not-an-email'], 'X'), null)
eq('no domain dot',       pick(['a@localhost'], 'X'), null)

// ── Domains that are never the business ─────────────────────────────────────
// Wix ships info@mysite.com in its template; it is on hundreds of sites.
eq('the Wix placeholder alone',  pick(['info@mysite.com'], 'Tail Waggers & Co.'), null)
// SURYA PET'S CLINIC — all three addresses belong to a commerce platform.
eq('a platform support desk',
  pick(['support@xirify.com','info@xirify.com','sales@xirify.com'], "SURYA PET'S CLINIC"), null)
// Pune Paw Prints — the scraper reached an aggregator's page.
eq('an aggregator',
  pick(['care@magicpin.in','partner@magicpin.in'], 'Pune Paw Prints'), null)
eq('rejecting one still returns the other',
  pick(['info@mysite.com','yatharthpet@gmail.com'], 'Yatharth Pets'), 'yatharthpet@gmail.com')

// ── The same address twice ──────────────────────────────────────────────────
eq('case is not a second address',
  pick(['support@zigly.com','support@Zigly.com'], 'Zigly'), 'support@zigly.com')

// ── The business's own domain wins ──────────────────────────────────────────
eq('on-domain beats a personal gmail',
  pick(['ameyavinash54@gmail.com','dramey@auravet.in'], 'Aura Vets', 'https://auravet.in/'),
  'dramey@auravet.in')
eq('and www. does not break the match',
  pick(['x@gmail.com','hello@tailsofthecity.in'], 'Tails of the City', 'http://www.tailsofthecity.in'),
  'hello@tailsofthecity.in')

// ── The front door, not the back office ─────────────────────────────────────
// Heads Up For Tails publishes four addresses on one page.
eq('hello@ beats hireme@',
  pick(['hireme@headsupfortails.com','hello@headsupfortails.com','grc@headsupfortails.com','wecare@headsupfortails.com'],
       'Pet Spa & Grooming by Heads Up For Tails', 'https://headsupfortails.com'),
  'hello@headsupfortails.com')
eq('a back-office mailbox is last resort, not never',
  pick(['careers@acme.in'], 'Acme', 'https://acme.in'), 'careers@acme.in')
eq('anything beats a back-office mailbox',
  pick(['careers@acme.in','bookings@acme.in'], 'Acme', 'https://acme.in'), 'bookings@acme.in')

// ── The name echoes, in either half ─────────────────────────────────────────
// MeowBnB: another company's address sits beside the owner's own.
eq('the name in the local part',
  pick(['info@pawsy.com','meowbnb.pune@gmail.com'], 'MeowBnB - Cat Boarding in Pune'),
  'meowbnb.pune@gmail.com')
eq('two gmails, one says the business',
  pick(['info@mysite.com','tailwaggersnco@gmail.com'], 'Tail Waggers & Co.'),
  'tailwaggersnco@gmail.com')
eq('the owner, not the stranger beside them',
  pick(['santoshzore75255@gmail.com','amitubale22@gmail.com'], "Santosh pet's dog walking sarvice"),
  'santoshzore75255@gmail.com')

// Generic words must not count as a name match, or every address "matches".
eq('"pet" alone is not a name match',
  pick(['someoneelse@gmail.com','another@gmail.com'], 'Pet Clinic'), 'someoneelse@gmail.com')

// ── Never invent, never reorder silently ────────────────────────────────────
eq('a single plain address is returned as is',
  pick(['punepetpark@gmail.com'], 'Pune Pet Park'), 'punepetpark@gmail.com')
eq('whitespace and case are normalised',
  pick(['  Info@Example-Vet.IN '], 'Example Vet'), 'info@example-vet.in')

console.log(`\nscraped email: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
