// visitPrep.js — what to take and do before a vet or grooming appointment.
//
// Deliberately NOT the same thing as a boarder's requirements. A boarder takes
// your animal away for days and publishes admission rules, so the boarding card
// reports what that facility actually asks for. Vets and groomers in the
// research published almost nothing comparable — so rather than invent
// requirements and put them in a business's mouth, these cards are advice to
// the pet parent. They claim nothing about the provider, which is why they can
// be shown against every one of them.
//
// Where a provider HAS told us its own rules, that belongs in boarding_policy
// and is rendered separately.

export const VISIT_PREP = {
  Vet: {
    title: 'What to take to a vet visit',
    note: 'General advice — not this clinic’s own requirements. Call ahead if your pet is unwell or it is a first visit.',
    groups: [
      {
        heading: 'Bring',
        items: [
          'Vaccination record — the original book if you have it, not just a photo.',
          'Every medicine your pet is on, including supplements and tick or flea products. The box beats a remembered name.',
          'Recent reports — blood work, scans, previous prescriptions.',
          'A sample if they asked for one. Stool and urine should be from that morning.',
        ],
      },
      {
        heading: 'Know before you go',
        items: [
          'What changed, and when it started — appetite, water, toilet, energy, weight, behaviour.',
          'Whether they said to fast beforehand. Many procedures need an empty stomach.',
          'Your questions, written down. They go out of your head in the room.',
        ],
      },
      {
        heading: 'On the day',
        items: [
          'A carrier for cats and small animals; a lead you trust for dogs.',
          'Let them toilet before you go in.',
          'Say if your pet is frightened of handling, other animals, or the table.',
        ],
      },
    ],
  },

  Groomer: {
    title: 'Before a grooming appointment',
    note: 'General advice — not this groomer’s own requirements. Ask what they need when you book.',
    groups: [
      {
        heading: 'Ask when booking',
        items: [
          'Whether they want proof of vaccination — many do, especially for a first visit.',
          'How long it takes, and whether you wait or come back.',
          'What it costs for your breed and coat. Matting and size usually change the price.',
        ],
      },
      {
        heading: 'Before you go',
        items: [
          'Check for ticks and fleas. Some groomers will turn a pet away, or charge extra to treat.',
          'Brush out what matting you can. Badly matted coat usually has to be shaved rather than trimmed — that is a welfare call, not a preference.',
          'Walk them first. A tired pet is easier to groom and has a better time.',
          'Let them toilet before the appointment.',
        ],
      },
      {
        heading: 'Tell the groomer',
        items: [
          'The cut you want, with a photo if you have one. "Short" means different things to different people.',
          'Skin problems, allergies, hot spots, lumps or sore ears.',
          'Anything they are frightened of — dryers, clippers, nail trims, being lifted.',
          'Any bite history. It keeps the groomer safe and gets your pet handled properly.',
        ],
      },
    ],
  },
}

export function visitPrepFor(type) {
  return VISIT_PREP[type] || null
}
