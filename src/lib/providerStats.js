// What the book adds up to.
//
// Everything here is a PURE FUNCTION over rows the shell has already loaded —
// no queries, no new round trips, nothing cached. The whole book for one
// business is a few hundred rows; counting them in the browser is cheaper than
// a request, and it means a number can never disagree with the list behind it.
//
// Two honest limits, stated here because every screen that uses this inherits
// them:
//
//   1. `amount` is optional and usually absent. Every total below reports how
//      many rows it could actually see a price for, so "₹12,400 from 3 of 9
//      stays" can never be read as "₹12,400 this month".
//   2. Cancelled and no-show entries are counted as cancellations, never as
//      business done. A kennel that counted its cancellations as stays would
//      be lying to itself about its own year.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DAY = 86400000
const asDate = d => new Date(`${d}T00:00:00Z`)
const monthKey = d => String(d).slice(0, 7)          // '2026-10'

export const isLost = a => a.status === 'cancelled' || a.status === 'no_show'

/**
 * Nights in a stay: the number of SLEEPS, not the number of dates touched.
 * In 14th → out 18th is four nights, which is what a kennel charges for and
 * what it would say out loud. A same-day or open-ended entry is zero nights —
 * it still counts as one visit everywhere that counts visits.
 */
export function nightsIn(a) {
  if (!a?.startsOn || !a?.endsOn) return 0
  const n = Math.round((asDate(a.endsOn) - asDate(a.startsOn)) / DAY)
  return n > 0 ? n : 0
}

const money = rows => {
  const priced = rows.filter(a => a.amount !== null && a.amount !== undefined && a.amount !== '')
  return { total: priced.reduce((s, a) => s + Number(a.amount || 0), 0),
           priced: priced.length, of: rows.length }
}

/**
 * One customer's history with this business.
 *
 * `window` is in days and defaults to a year, because "how many times this
 * year" is the question actually asked — a lifetime count flatters an old
 * customer who has not been back since 2024.
 */
export function customerStats(appointments = [], today, window = 365) {
  const from = new Date(asDate(today).getTime() - window * DAY).toISOString().slice(0, 10)

  const mine   = [...appointments].sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)))
  const done   = mine.filter(a => !isLost(a))
  const recent = done.filter(a => a.startsOn >= from)
  const lost   = mine.filter(isLost)

  const byKind = {}
  for (const a of recent) byKind[a.kind || 'Other'] = (byKind[a.kind || 'Other'] || 0) + 1

  const nights = recent.reduce((s, a) => s + nightsIn(a), 0)
  const withNights = recent.filter(a => nightsIn(a) > 0).length

  return {
    visits: recent.length,
    visitsAllTime: done.length,
    nights,
    // Averaged over the stays that HAVE nights, not over every entry: a groom
    // in the middle of a boarder's year would otherwise drag the average stay
    // length down towards zero.
    avgNights: withNights ? Math.round((nights / withNights) * 10) / 10 : 0,
    byKind: Object.entries(byKind).sort((a, b) => b[1] - a[1]),
    first: done[0]?.startsOn || null,
    last:  done.length ? done[done.length - 1].startsOn : null,
    cancelled: lost.filter(a => a.status === 'cancelled').length,
    noShows:   lost.filter(a => a.status === 'no_show').length,
    money: money(recent),
    months: monthsBack(recent, today, 12),
  }
}

/**
 * The last `count` months, oldest first, with a row for every month — including
 * the empty ones. A chart that silently drops a quiet month draws a flat line
 * through a gap and calls it steady business.
 */
export function monthsBack(appointments = [], today, count = 12) {
  const end = asDate(today)
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    out.push({
      key: d.toISOString().slice(0, 7),
      label: MONTHS[d.getUTCMonth()],
      year: d.getUTCFullYear(),
      visits: 0, nights: 0, amount: 0, priced: 0,
    })
  }
  const byKey = Object.fromEntries(out.map(m => [m.key, m]))
  for (const a of appointments) {
    if (isLost(a)) continue
    const m = byKey[monthKey(a.startsOn)]
    if (!m) continue
    m.visits += 1
    m.nights += nightsIn(a)
    if (a.amount !== null && a.amount !== undefined && a.amount !== '') {
      m.amount += Number(a.amount || 0); m.priced += 1
    }
  }
  return out
}

/**
 * How many animals are on the premises on the busiest single day of a month.
 *
 * Not the same as the number of stays that month, and it is the number that
 * decides whether there is a bed and a pair of hands. A stay occupies every
 * date from its start to the day before it leaves — the morning of departure is
 * not another full day of care.
 */
export function peakDay(appointments = [], monthKeyWanted) {
  const perDay = {}
  for (const a of appointments) {
    if (isLost(a) || !a.startsOn) continue
    const start = asDate(a.startsOn)
    const nights = nightsIn(a)
    for (let i = 0; i <= nights; i++) {
      // A stay with nights occupies its last night, not its checkout morning.
      if (nights > 0 && i === nights) break
      const day = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10)
      if (monthKeyWanted && monthKey(day) !== monthKeyWanted) continue
      perDay[day] = (perDay[day] || 0) + 1
    }
  }
  let best = { on: null, count: 0 }
  for (const [on, count] of Object.entries(perDay)) if (count > best.count) best = { on, count }
  return best
}

/** The dashboard's year: this month, the twelve behind it, and who came back. */
export function bookYear({ customers = [], appointments = [] }, today) {
  const thisMonth = monthKey(today)
  const months = monthsBack(appointments, today, 12)
  const now = months[months.length - 1]

  const done = appointments.filter(a => !isLost(a))
  const perCustomer = {}
  for (const a of done) perCustomer[a.customerId] = (perCustomer[a.customerId] || 0) + 1
  const returning = Object.values(perCustomer).filter(n => n > 1).length

  const newThisMonth = customers.filter(c => monthKey(c.createdAt || '') === thisMonth).length

  return {
    months,
    thisMonth: { ...now, peak: peakDay(appointments, thisMonth) },
    year: {
      visits: months.reduce((s, m) => s + m.visits, 0),
      nights: months.reduce((s, m) => s + m.nights, 0),
      amount: months.reduce((s, m) => s + m.amount, 0),
      priced: months.reduce((s, m) => s + m.priced, 0),
    },
    returning,
    // Of the customers who have ever been booked in — not of everyone in the
    // book, which would count a card typed in this morning as a lost customer.
    booked: Object.keys(perCustomer).length,
    newThisMonth,
    busiest: months.reduce((b, m) => (m.visits > (b?.visits ?? -1) ? m : b), null),
  }
}

/** ₹1,23,456 — Indian digit grouping, no decimals. Amounts here are whole rupees. */
export function rupees(n) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
