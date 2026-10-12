// What to actually DO about a breed health note.
//
// ── Why this exists ─────────────────────────────────────────────────────────
//
// The breed panel listed a Labrador's risks as "Hip & elbow dysplasia,
// Obesity tendency, Exercise-induced collapse, Progressive retinal atrophy",
// each behind a warning triangle, and stopped there. An owner reported that
// as off-putting on the day they added their first dog, which is fair: it is
// four frightening nouns and no way to act on any of them.
//
// ── Why this is grouped by theme and not written per condition ──────────────
//
// There are 94 distinct concerns across 73 breeds. Writing a paragraph of
// medical explanation for each would mean inventing 94 pieces of veterinary
// content, which is not something to do from memory in an app people keep
// their animal's health record in.
//
// What IS safe to say is general care that holds regardless of the specific
// condition: keep them lean, know which signs mean "today, not next week",
// mention the breed before anaesthesia. So each note is matched to a theme and
// the theme carries the advice. A new breed added tomorrow inherits sensible
// guidance without anybody writing new medical copy, and anything unmatched
// falls back to "raise it at the next check-up" rather than to silence.
//
// Nothing here is a diagnosis or a treatment. Every line either describes
// ordinary care or says to ask a vet. That boundary is the whole design, and
// it is worth keeping if these are ever edited.

/**
 * Themes, tried in order. The first whose `match` hits wins, so put the
 * specific ones above the general ones -- "Bloat (GDV)" must be caught by the
 * emergency theme before anything matches on the word "bloat".
 *
 * `urgent` marks the ones where the useful information is "this is an
 * emergency", so the screen can show them differently from "mention it at the
 * next visit".
 */
const THEMES = [
  {
    id: 'bloat',
    urgent: true,
    match: /bloat|gdv|gi stasis|wet tail/i,
    helps: 'This one is an emergency, not a wait-and-see. Learn the signs now — a hard or swollen belly, trying to be sick without bringing anything up, sudden restlessness, or a rabbit that stops eating and passing droppings — and find your nearest out-of-hours vet before you ever need it.',
  },
  {
    id: 'weight',
    match: /obesity|overweight/i,
    helps: 'Keeping them lean is the single biggest thing in your control, and it makes most of the other risks smaller too. Ask your vet to show you how to body-condition score, agree a target weight, and measure meals rather than topping up the bowl.',
  },
  {
    id: 'joints',
    match: /dysplasia|patellar|luxation|ivdd|intervertebral|disc disease|spinal|myelopathy|wobbler|joint|fracture|osteochondro|lean build/i,
    helps: 'Weight is the lever here: every extra kilo is load on the joints. Go easy on repeated jumping and long runs on hard ground while they are still growing, and ask your vet whether screening is worth doing for this breed.',
  },
  {
    id: 'airway',
    match: /brachycephalic|tracheal|heat sensitiv|respiratory|facial deformity|airway/i,
    helps: 'Heat and exertion are what turn this into a problem. Walk in the cool part of the day, use a harness rather than a neck collar, keep them lean, and learn what their normal breathing looks and sounds like so you notice when it changes.',
  },
  {
    id: 'heart',
    match: /heart|cardiomyopathy|mitral|\bsas\b|\bdcm\b|\bhcm\b/i,
    helps: 'Ask your vet to listen to the heart at every check-up — that is how most of these are picked up first. Tell them if you notice coughing, tiring sooner than usual on walks, or faster breathing while asleep.',
  },
  {
    id: 'eyes',
    match: /eye|retinal|corneal|cherry|entropion|\bpra\b/i,
    helps: 'Mention anything cloudy, red or weepy. Tell your vet if they start bumping into furniture or hesitate in dim light, and ask whether an eye check is worth adding to the annual visit.',
  },
  {
    id: 'skin',
    match: /skin|dermatitis|dermatosis|allerg|mange|sebaceous|sunburn|coat|perianal|fistula/i,
    helps: 'Check skin, ears, paws and under the tail while you groom — it takes a minute and catches most of this early. Persistent scratching, head-shaking, licking at one spot, or a smell from the ears is worth a vet visit rather than a wait.',
  },
  {
    id: 'dental',
    match: /dental|teeth|tooth/i,
    helps: 'Daily brushing with a toothpaste made for pets does more than anything else, and it is easiest if you start young. Ask your vet to look at the teeth at every visit.',
  },
  {
    id: 'cancer',
    match: /cancer|tumour|tumor/i,
    helps: 'Nothing prevents this, but finding it early changes what can be done. Run your hands over them once a week and tell your vet about any lump that is new, growing, or has changed.',
  },
  {
    id: 'neuro',
    match: /epilep|seizure|syringomyelia|encephalitis|shaker|episodic falling|muscular atrophy|collapse|\beic\b|deaf/i,
    helps: 'If you ever see a seizure, a collapse or an odd episode, film it if you can safely do so — thirty seconds of video tells a vet far more than any description. Note the date and roughly how long it lasted.',
  },
  {
    id: 'endocrine',
    match: /hypothyroid|addison|cushing|diabet|hypokalemia|endocrine|thyroid/i,
    helps: 'These show up as changes that are easy to put down to age: weight gain or loss, drinking more, low energy, a duller coat. Blood tests are how they get found, so mention any of it rather than waiting.',
  },
  {
    id: 'kidney',
    match: /kidney|renal|\bpkd\b|amyloidosis|bladder|urinary|stones|shunt|liver/i,
    helps: 'Tell your vet if they drink or urinate noticeably more than usual, or strain when they go. Keep fresh water available at all times — it matters more for these breeds than most.',
  },
  {
    id: 'medication',
    match: /mdr1|anesthesia|anaesthesia|drug|von willebrand|body fat|pyruvate kinase/i,
    helps: 'Tell any vet about this before anaesthesia, surgery or a new medicine — the safe dose and the safe drug can both be different for this breed. Keep it in the pet\'s notes so it is not forgotten by whoever sees them in an emergency.',
  },
  {
    id: 'parasites',
    match: /tick fever|parasite|e\. cuniculi|cuniculi/i,
    helps: 'Keep tick and worm prevention on a regular schedule rather than when you remember, and check them over after walks in long grass. Pippy can remind you if you add it as a reminder.',
  },
  {
    id: 'cold',
    match: /cold sensitiv|thin coat|thin skin/i,
    helps: 'A coat for cold mornings, and shorter walks when it is properly cold. Thin skin tears more easily too, so check for small cuts after rough play or scrub.',
  },
  {
    id: 'diet',
    match: /scurvy|vitamin/i,
    helps: 'This one is about what goes in the bowl every day, not an illness to watch for. Ask your vet to confirm the diet covers it, because the gap only shows up once there is a problem.',
  },
  {
    id: 'reproductive',
    match: /uterine|unspayed|spay|neuter/i,
    helps: 'Worth a conversation with your vet about whether and when to spay, since it changes this risk substantially. There is no single right answer and it depends on the animal.',
  },
  {
    id: 'hardy',
    positive: true,
    match: /hardy|hybrid vigour|hybrid vigor|minimal breed-specific|fewer breed-specific/i,
    helps: 'Good news, and it is still worth an annual check-up — being robust mostly means problems get noticed later rather than never.',
  },
]

/** The theme covering `concern`, or null when nothing matches. */
export function themeFor(concern) {
  const text = String(concern || '')
  if (!text.trim()) return null
  return THEMES.find(t => t.match.test(text)) || null
}

const FALLBACK = 'Worth raising at the next check-up so your vet knows to keep an eye on it. It is not something to act on today.'

/**
 * Practical guidance for one breed note.
 *
 * Always returns something: a concern with no advice attached is the problem
 * this module exists to fix, so an unmatched note falls back to "mention it"
 * rather than to a blank space.
 */
export function guidanceFor(concern) {
  const theme = themeFor(concern)
  return {
    id:       theme?.id || 'general',
    helps:    theme?.helps || FALLBACK,
    urgent:   !!theme?.urgent,
    positive: !!theme?.positive,
  }
}

/** Does this breed's list contain anything that needs acting on at once? */
export function hasUrgent(concerns = []) {
  return concerns.some(c => guidanceFor(c).urgent)
}

export const THEME_IDS = THEMES.map(t => t.id)
