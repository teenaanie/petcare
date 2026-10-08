// What the book is called, business by business.
//
// The tables underneath are the same for every provider: a customer, their
// animals, and dated entries against them. What differs is the VOCABULARY. A
// kennel books a stay and writes it up day by day; a vet records a visit and
// what was given; a shop records a purchase and what was bought. Those are the
// same three rows with different words on them, and inventing a second schema
// per trade would be inventing the same thing three times.
//
// So this file is words, not behaviour — with two exceptions that are real
// differences rather than labels:
//
//   flags   trial day and boarding criteria are a BOARDER's gate. A groomer has
//           no trial run and a shop has no criteria; showing them would be
//           asking every business to answer a kennel's question.
//   nights  a stay spans nights and that is how a boarder counts their year. A
//           visit and a purchase happen on a day. Counting "nights" for a vet
//           would report zero forever and look broken.
//
// `kind` on provider_appointments is a free-text column with no CHECK, so the
// lists below need no migration to change. They are NOT the directory
// vocabularies in taxonomy.js — those label a business in a public directory
// and are closed on purpose. These label a provider's own private rows.

const BOARDER = {
  entry: 'stay', entries: 'stays',
  addLabel: 'Book a stay', emptyLine: 'No stays yet.',
  kinds: ['Boarding', 'Day care', 'Grooming', 'Walk', 'Other'],
  flags: true, counts: 'nights',
  logTitle: 'Day by day',
  logHint: 'Ate everything, slept through.',
}

const GROOMER = {
  entry: 'visit', entries: 'visits',
  addLabel: 'Book a visit', emptyLine: 'No visits yet.',
  kinds: ['Grooming', 'Bath', 'Nail trim', 'De-shedding', 'Other'],
  flags: false, counts: 'visits',
  logTitle: 'What was done',
  logHint: 'Full groom, nails, ears. Nervous with the dryer.',
}

const VET = {
  entry: 'visit', entries: 'visits',
  addLabel: 'Record a visit', emptyLine: 'No visits yet.',
  kinds: ['Consultation', 'Vaccination', 'Deworming', 'Procedure', 'Follow-up', 'Other'],
  flags: false, counts: 'visits',
  // A vet's log IS the clinical record of that visit, which is why it is dated
  // per entry rather than being one box on the visit: a course of medication
  // and the booster that preceded it are two different days.
  logTitle: 'Given on the day',
  logHint: 'Rabies booster given. Meloxicam 1.5ml, 3 days.',
}

const STORE = {
  entry: 'purchase', entries: 'purchases',
  addLabel: 'Record a purchase', emptyLine: 'Nothing bought yet.',
  kinds: ['Purchase', 'Order', 'Delivery', 'Return', 'Other'],
  flags: false, counts: 'purchases',
  logTitle: 'What was bought',
  logHint: '2kg adult kibble, one chew toy.',
}

const GENERIC = {
  entry: 'visit', entries: 'visits',
  addLabel: 'Record a visit', emptyLine: 'Nothing recorded yet.',
  kinds: ['Visit', 'Session', 'Other'],
  flags: false, counts: 'visits',
  logTitle: 'What happened',
  logHint: 'What you want to remember about the day.',
}

// Keyed by the provider TYPE as taxonomy.js spells it. A type with no entry of
// its own falls through to GENERIC rather than to BOARDER: a dog walker asked
// about boarding criteria would reasonably conclude the app was not built for
// them, and being asked nothing is better than being asked the wrong thing.
const BY_TYPE = {
  Boarder: BOARDER,
  Groomer: GROOMER,
  Vet:     VET,
  Store:   STORE,
  'Dog Walking': { ...GENERIC, entry: 'walk', entries: 'walks', addLabel: 'Record a walk',
                   kinds: ['Walk', 'Group walk', 'Other'], counts: 'walks',
                   logTitle: 'How it went', logHint: 'Pulled less today. Met two dogs, fine with both.',
                   emptyLine: 'No walks yet.' },
  Training: { ...GENERIC, entry: 'session', entries: 'sessions', addLabel: 'Record a session',
              kinds: ['Session', 'Assessment', 'Group class', 'Other'], counts: 'sessions',
              logTitle: 'What we worked on', logHint: 'Recall on a long line. Homework: 5 minutes daily.',
              emptyLine: 'No sessions yet.' },
  'Pet Sitting': { ...GENERIC, entry: 'visit', entries: 'visits', addLabel: 'Record a visit',
                   kinds: ['Home visit', 'Overnight', 'Drop-in', 'Other'], counts: 'visits',
                   logTitle: 'What happened', logHint: 'Fed, litter changed, played twenty minutes.' },
}

/**
 * The dashboard's tile labels for a trade.
 *
 * "With you now" is a boarding sentence: a vet does not have your cat on the
 * premises for four days. Everything else is the entry noun, so a shop reads
 * "Past purchases" rather than "Past stays".
 */
export function tileWords(words) {
  const overnight = words.counts === 'nights'
  return {
    here:      overnight ? 'With you now' : 'In today',
    hereHint:  overnight ? 'Pets in your care today' : `${words.entries} happening today`,
    upcoming:  'Coming up',
    upHint:    overnight ? 'Booked, not yet arrived' : 'Booked ahead',
    past:      `Past ${words.entries}`,
    pastHint:  'Everything behind you',
  }
}

/** The words this business uses. Unknown or missing type → the generic set. */
export function bookWords(providerType) {
  return BY_TYPE[providerType] || GENERIC
}

export { BOARDER, GROOMER, VET, STORE, GENERIC }
