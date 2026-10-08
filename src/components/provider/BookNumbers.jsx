import { useState } from 'react'
import { TrendingUp, History, Trophy, ChevronRight } from 'lucide-react'
import { customerStats, bookYear, rupees, topCustomers } from '../../lib/providerStats.js'
import { bookWords } from '../../lib/providerTypes.js'
import { formatDay } from '../../lib/providerBrief.js'

// The book, added up.
//
// ── Why these forms ─────────────────────────────────────────────────────────
//
// A handful of headline figures is a KPI row of stat tiles, not a chart: a
// bar chart of "14 stays this month" is a worse way to say fourteen. The one
// thing here that IS a chart is twelve months side by side, because the job is
// comparing magnitude over time and that is the only question in the book a
// number cannot answer — a boarder knows this month was busy, and does not know
// it was their third-best month in a year that peaks every Diwali.
//
// ── Why one colour ──────────────────────────────────────────────────────────
//
// One series, so one hue and no legend — the heading says what is plotted.
// #b5731a is the brand amber stepped down until it clears 3:1 against the cream
// surface; the lighter brand #f2b83d measures 1.78 and a bar you cannot see is
// not a bar. Checked with the palette validator rather than by eye.
//
// Direct labels are selective on purpose: the busiest month and the current one
// carry their value, everything else is carried by the axis and the hover. A
// number on all twelve is noise and goes unread.

const INK      = '#4A2C0A'
const MUTED    = '#73775b'
const LABEL    = '#b08d57'
const BAR      = '#b5731a'
const BASELINE = '#ebe3d3'

function Figure({ label, value, hint }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: LABEL }}>{label}</p>
      <p className="text-2xl font-black leading-none mt-1" style={{ color: INK }}>{value}</p>
      {hint && <p className="text-[11px] mt-1" style={{ color: MUTED }}>{hint}</p>}
    </div>
  )
}

/**
 * Twelve months, oldest first.
 *
 * Every month gets a column even when it is empty — a chart that drops a quiet
 * month draws a straight line through the gap and calls it steady business.
 */
export function MonthBars({ months, metric, unit, onPick }) {
  const max  = Math.max(1, ...months.map(m => m[metric]))
  const peak = months.reduce((b, m) => (m[metric] > (b?.[metric] ?? -1) ? m : b), null)
  const now  = months[months.length - 1]

  return (
    <div>
      <div className="flex items-end gap-1 sm:gap-1.5" style={{ height: 112 }}>
        {months.map(m => {
          const v = m[metric]
          const tall = v > 0 ? Math.max(3, Math.round((v / max) * 84)) : 0
          const loud = m.key === now.key || m.key === peak?.key
          // A bar is a question: the figure says fourteen and the next thing
          // asked is always "fourteen of whom". Tapping one answers it. A month
          // with nothing in it is not a button, because there is nothing behind
          // it to show.
          const Tag = onPick && v > 0 ? 'button' : 'div'
          return (
            <Tag key={m.key} type={Tag === 'button' ? 'button' : undefined}
              onClick={Tag === 'button' ? () => onPick(m.key) : undefined}
              className="flex-1 flex flex-col items-center justify-end h-full"
              style={Tag === 'button' ? { cursor: 'pointer' } : undefined}
              aria-label={Tag === 'button' ? `See ${m.label} ${m.year}` : undefined}
              title={`${m.label} ${m.year} — ${v} ${unit}${Tag === 'button' ? ' · tap to see who' : ''}`}>
              {/* Every month carries its number. The first version labelled only
                  the peak and the current month, which on a dashboard where
                  those are usually the SAME month meant exactly one number on
                  screen and eleven bars you had to hover to read. A fixed-height
                  row so a month with nothing in it does not shorten its own
                  column. */}
              <span className="text-[10px] leading-none font-black" style={{ height: 12, color: loud ? INK : MUTED }}>
                {v > 0 ? v : ''}
              </span>
              <div aria-label={`${m.label} ${m.year}: ${v} ${unit}`}
                className="w-full rounded-t"
                style={{ height: tall, maxWidth: 24, backgroundColor: BAR, opacity: loud ? 1 : 0.72 }} />
            </Tag>
          )
        })}
      </div>
      <div style={{ borderTop: `1px solid ${BASELINE}` }} className="mt-1" />
      <div className="flex gap-1 sm:gap-1.5 mt-1">
        {months.map(m => (
          <span key={m.key} className="flex-1 text-center text-[10px]"
            style={{ color: m.key === now.key ? INK : MUTED,
                     fontWeight: m.key === now.key ? 800 : 400 }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// What a provider can be shown, in the order they would ask for it. `nights`
// drops out for anybody who does not keep animals overnight, where it would
// report zero forever and look broken rather than inapplicable.
function metricsFor(words, months) {
  const out = []
  if (words.counts === 'nights') out.push({ key: 'nights', label: 'Nights', unit: 'nights' })
  out.push({ key: 'visits', label: words.entries.replace(/^./, c => c.toUpperCase()), unit: words.entries })
  if (months.some(m => m.priced > 0)) out.push({ key: 'amount', label: 'Money', unit: 'rupees', money: true })
  return out
}

function Toggle({ options, value, onChange }) {
  if (options.length < 2) return null
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
          style={value === o.key ? { backgroundColor: '#f2b83d', color: '#7a4900' }
                                 : { backgroundColor: '#f5f0e0', color: MUTED }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The dashboard's year: this month in figures, then twelve months of shape. */
export function YourYear({ book, today, providerType, onPickMonth, onOpenCustomer }) {
  const words = bookWords(providerType)
  const y = bookYear(book, today)
  const metrics = metricsFor(words, y.months)
  const [metric, setMetric] = useState(metrics[0].key)
  const chosen = metrics.find(m => m.key === metric) || metrics[0]

  if (book.appointments.length === 0) return null

  const nothingYet = y.year.visits === 0
  const monthsShown = chosen.money
    ? y.months.map(m => ({ ...m, amount: Math.round(m.amount) }))
    : y.months

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: LABEL }}>
          <TrendingUp className="w-3.5 h-3.5" /> Your year
        </p>
        <Toggle options={metrics} value={metric} onChange={setMetric} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Figure label="This month" value={y.thisMonth.visits} hint={words.entries} />
        {words.counts === 'nights'
          ? <Figure label="Nights" value={y.thisMonth.nights} hint="Booked this month" />
          : <Figure label="This year" value={y.year.visits} hint={`${words.entries} in 12 months`} />}
        <Figure label="Busiest day" value={y.thisMonth.peak.count}
          hint={y.thisMonth.peak.on ? formatDay(y.thisMonth.peak.on) : 'Nothing booked'} />
        <Figure label="Came back" value={`${y.returning}/${y.booked}`}
          hint="Customers with more than one" />
      </div>

      {nothingYet ? (
        <p className="text-sm" style={{ color: MUTED }}>
          Nothing in the last twelve months yet. This fills in as you record {words.entries}.
        </p>
      ) : (
        <>
          <MonthBars months={monthsShown} metric={metric} unit={chosen.unit} onPick={onPickMonth} />
          <p className="text-xs mt-3" style={{ color: MUTED }}>
            {chosen.money
              ? <>{rupees(y.year.amount)} across the year, from the {y.year.priced} of {y.year.visits} {words.entries} you
                  put a price on. The rest are not counted.</>
              : <>Busiest month: {y.busiest.label} {y.busiest.year} ({y.busiest.visits} {words.entries}).
                  {y.newThisMonth > 0 && ` ${y.newThisMonth} new customer${y.newThisMonth === 1 ? '' : 's'} this month.`}</>}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Who comes back most.
 *
 * Ranked by visits TAKEN, not by money: the question behind it is "who would I
 * give something to", and ranking by revenue ranks by who owns the biggest dog.
 * A customer who books and cancels is not a top customer, so cancellations are
 * nowhere in it.
 *
 * A list, not a chart. Ten names with a count each is a table's job — a bar
 * chart of ten customers would be ten bars nobody can tell apart at a glance,
 * and the thing being compared is the NAMES.
 */
export function TopCustomers({ book, today, providerType, onOpen }) {
  const words = bookWords(providerType)
  const rows = topCustomers(book, today)
  if (rows.length < 3) return null   // a top ten of two is a customer list

  const most = rows[0].visits

  return (
    <div className="card">
      <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 mb-1" style={{ color: LABEL }}>
        <Trophy className="w-3.5 h-3.5" /> Who comes back most
      </p>
      <p className="text-xs mb-3" style={{ color: MUTED }}>
        The last 12 months, by {words.entries} taken. Cancellations are not counted.
      </p>

      <div>
        {rows.map((c, i) => (
          <button key={c.id} onClick={() => onOpen?.(c.id)}
            className="w-full text-left flex items-center gap-3 py-2"
            style={{ borderTop: i === 0 ? 'none' : '1px solid #f5f0e0' }}>
            <span className="text-xs font-black w-5 shrink-0" style={{ color: LABEL }}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="text-sm font-bold block truncate" style={{ color: INK }}>{c.name}</span>
              <span className="text-xs" style={{ color: MUTED }}>
                {c.visits} {c.visits === 1 ? words.entry : words.entries}
                {words.counts === 'nights' && c.nights > 0 && ` · ${c.nights} nights`}
                {c.priced > 0 && ` · ${rupees(c.amount)}`}
              </span>
            </span>
            {/* A bar against the top customer, so the shape of the list reads
                without comparing numbers one by one. */}
            <span className="hidden sm:block w-24 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#f5f0e0' }}>
              <span className="block h-full rounded-full"
                style={{ width: `${Math.round((c.visits / most) * 100)}%`, backgroundColor: BAR }} />
            </span>
            <ChevronRight className="w-4 h-4 shrink-0" style={{ color: LABEL }} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** One customer's history with this business. */
export function CustomerHistory({ appointments, today, providerType }) {
  const words = bookWords(providerType)
  const s = customerStats(appointments, today)
  if (s.visitsAllTime === 0 && s.cancelled === 0 && s.noShows === 0) return null

  const unreliable = s.cancelled + s.noShows

  return (
    <div className="card">
      <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 mb-4" style={{ color: LABEL }}>
        <History className="w-3.5 h-3.5" /> Their history
      </p>

      <div className="grid grid-cols-3 gap-4">
        <Figure label="Last 12 months" value={s.visits} hint={words.entries} />
        {words.counts === 'nights'
          ? <Figure label="Nights" value={s.nights} hint={s.avgNights ? `${s.avgNights} a stay on average` : 'None overnight'} />
          : <Figure label="All time" value={s.visitsAllTime} hint={words.entries} />}
        <Figure label="With you since" value={s.first ? formatDay(s.first).replace(/ \d{4}$/, '') : '—'}
          hint={s.first ? String(s.first).slice(0, 4) : null} />
      </div>

      {s.byKind.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-4">
          {s.byKind.map(([kind, n]) => (
            <span key={kind} className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: '#f5f0e0', color: '#5f624b' }}>
              {kind} · {n}
            </span>
          ))}
        </div>
      )}

      {s.visits > 0 && (
        <div className="mt-5">
          <MonthBars months={s.months} metric={words.counts === 'nights' ? 'nights' : 'visits'}
            unit={words.counts === 'nights' ? 'nights' : words.entries} />
        </div>
      )}

      <div className="mt-4 text-xs space-y-1" style={{ color: MUTED }}>
        {s.last && <p>Last {words.entry}: {formatDay(s.last)}.</p>}
        {/* Said plainly rather than hidden in a total. It is the thing worth
            knowing before a peak-season slot is held for somebody. */}
        {unreliable > 0 && (
          <p style={{ color: '#c9891f' }}>
            {s.cancelled > 0 && `${s.cancelled} cancellation${s.cancelled === 1 ? '' : 's'}`}
            {s.cancelled > 0 && s.noShows > 0 && ', '}
            {s.noShows > 0 && `${s.noShows} no-show${s.noShows === 1 ? '' : 's'}`}
            {' '}in their history.
          </p>
        )}
        {s.money.priced > 0 && (
          <p>{rupees(s.money.total)} in the last 12 months, across the {s.money.priced} of {s.money.of}{' '}
            {words.entries} with a price on them.</p>
        )}
      </div>
    </div>
  )
}
