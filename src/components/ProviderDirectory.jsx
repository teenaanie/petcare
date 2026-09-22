import { useEffect, useState, useMemo } from 'react'
import { Search, MapPin, Phone, Clock, ExternalLink, MessageCircle, Stethoscope, Scissors, ShoppingBag, Home, Camera, Flower2, Loader2, AlertCircle, ClipboardCheck, ChevronDown, ChevronRight, Footprints, GraduationCap } from 'lucide-react'
// MapPin used in ProviderCard address row
import { getProviders, getProviderFacets } from '../lib/storage.js'
import { resolvePolicy, hasCustomPolicy, REQUIREMENT_CATALOG, GENERIC_PROVENANCE } from '../lib/boarding.js'
import { visitPrepFor } from '../lib/visitPrep.js'

// Category colours are drawn from the brand's secondary palette — azure,
// yellow-green, orange-yellow and coral — rather than generic UI colours.
// They still have to stay mutually distinguishable, so each is a distinct
// brand family darkened to carry legible text on its own tint.
const TYPE_CONFIG = {
  Vet:      { icon: Stethoscope, color: '#2f7286', bg: '#eef8fb', label: 'Vet Clinic' },
  Groomer:  { icon: Scissors,    color: '#b2566f', bg: '#fdeef2', label: 'Groomer' },
  Store:    { icon: ShoppingBag, color: '#5f7a3a', bg: '#f4f8ea', label: 'Pet Store' },
  Boarder:  { icon: Home,        color: '#c9891f', bg: '#fff9e0', label: 'Boarding' },
  'Dog Walking': { icon: Footprints,    color: '#5f7a3a', bg: '#eef3e2', label: 'Dog Walking' },
  Training:      { icon: GraduationCap, color: '#255d6e', bg: '#dceff5', label: 'Training' },
  'Special Services':             { icon: Camera,  color: '#c0563d', bg: '#fdefe9', label: 'Special Services' },
  'Pet Loss & Memorial Services': { icon: Flower2, color: '#5f624b', bg: '#eff0e8', label: 'Pet Loss & Memorial' },
}

// Dog Walking and Training used to live inside "Special Services", which the
// importer defined as one regex over trainer|walker|breeder|photographer|
// adoption — six unrelated businesses in one bucket. They're real tabs now.
const CATEGORIES = ['Vet', 'Groomer', 'Store', 'Boarder', 'Dog Walking', 'Training', 'Special Services', 'Pet Loss & Memorial Services']

const TABS = [
  { id: 'All', label: 'All', color: '#7a4900', bg: '#ebe3d3' },
  ...CATEGORIES.map(id => ({ id, ...TYPE_CONFIG[id] })),
]

const OTHER_KEY = '__other__'
const PAGE_SIZE = 60

function toTitleCase(s) {
  return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

function TypeBadge({ type }) {
  const cfg = TYPE_CONFIG[type] || { color: '#73775b', bg: '#fffef8', label: type }
  const Icon = cfg.icon || ShoppingBag
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  )
}

function BoardingRequirements({ provider }) {
  const [open, setOpen] = useState(false)
  const policy = resolvePolicy(provider)
  const custom = hasCustomPolicy(provider)

  // The catalogue already carries a label and a one-line explanation for every
  // requirement, so the directory doesn't keep a second copy of that wording.
  const label = id => REQUIREMENT_CATALOG.find(r => r.id === id)?.label || id
  const help  = id => REQUIREMENT_CATALOG.find(r => r.id === id)?.help  || ''
  const windows = (policy.slot_windows || []).map(w => `${w.from}–${w.to}`).join(' · ')

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ backgroundColor: custom ? '#fff9e0' : '#f5f0e0' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold"
        style={{ color: '#7a4900' }}>
        <span className="flex items-center gap-1.5 text-left">
          <ClipboardCheck className="w-3.5 h-3.5 flex-shrink-0" />
          {custom ? 'What they need before a stay' : 'What boarders usually need'}
        </span>
        {open ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {!custom && (
            <>
              <p className="text-xs pb-1" style={{ color: '#c0563d' }}>
                We don’t have this boarder’s own list yet — this is the general one. Confirm it with them.
              </p>
              <p className="text-xs pb-1" style={{ color: '#878c6b' }}>{GENERIC_PROVENANCE}</p>
            </>
          )}

          {(policy.required || []).map(id => (
            <p key={id} className="text-xs flex gap-1.5" style={{ color: '#73775b' }}>
              <span aria-hidden>·</span>
              <span><span className="font-semibold" style={{ color: '#7a4900' }}>{label(id)}</span>
                {help(id) ? ` — ${help(id)}` : ''}</span>
            </p>
          ))}

          {policy.trial_required && (
            <p className="text-xs flex gap-1.5" style={{ color: '#73775b' }}>
              <span aria-hidden>·</span><span>A trial visit is required before the first stay.</span>
            </p>
          )}

          {windows && (
            <p className="text-xs pt-1.5" style={{ color: '#c0563d', borderTop: '1px solid #ebe3d3' }}>
              Drop-off and pick-up only {windows} — outside these hours is billed as an extra day.
            </p>
          )}
          {policy.pricing?.full_day && (
            <p className="text-xs" style={{ color: '#73775b' }}>
              From ₹{policy.pricing.full_day.toLocaleString('en-IN')} a day. {policy.pricing.note || ''}
            </p>
          )}
          {policy.arrival_notes && (
            <p className="text-xs" style={{ color: '#73775b' }}>{policy.arrival_notes}</p>
          )}
        </div>
      )}
    </div>
  )
}

// Advice to the pet parent, shown against any vet or groomer. It asserts
// nothing about the business, which is exactly why it can be shown against all
// of them — unlike the boarding card, which reports a facility's own rules and
// stays silent when we don't have them.
function VisitPrep({ type }) {
  const [open, setOpen] = useState(false)
  const prep = visitPrepFor(type)
  if (!prep) return null

  return (
    <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#eef8fb' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold"
        style={{ color: '#255d6e' }}>
        <span className="flex items-center gap-1.5 text-left">
          <ClipboardCheck className="w-3.5 h-3.5 flex-shrink-0" /> {prep.title}
        </span>
        {open ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3">
          {prep.groups.map(g => (
            <div key={g.heading} className="mt-2 first:mt-0">
              <p className="text-xs font-black uppercase tracking-wider mb-1" style={{ color: '#2f7286' }}>{g.heading}</p>
              {g.items.map((item, i) => (
                <p key={i} className="text-xs flex gap-1.5 mb-1" style={{ color: '#255d6e' }}>
                  <span aria-hidden>·</span><span>{item}</span>
                </p>
              ))}
            </div>
          ))}
          <p className="text-xs mt-2 pt-2" style={{ color: '#5f7a8a', borderTop: '1px solid #cfe6ef' }}>
            {prep.note}
          </p>
        </div>
      )}
    </div>
  )
}

function ProviderCard({ p, onPrepForStay }) {
  const waNumber = p.whatsapp?.replace(/\D/g, '') || p.phone?.replace(/\D/g, '')
  const waLink   = waNumber ? `https://wa.me/${waNumber}` : null
  const isBoarder = p.type === 'Boarder'

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3' }}>

      {/* Photos survive only for providers who supplied their own — a business
          that registered itself, or one an admin added. The scraped ones were
          hotlinks into Google's CDN: somebody else's copyright, every visitor's
          IP handed to Google on page load, and URLs that expire and leave the
          directory full of broken images. Those have been cleared. */}
      {p.photo_url && (
        <img src={p.photo_url} alt={p.name} loading="lazy"
          className="w-full h-36 object-cover"
          onError={e => { e.currentTarget.style.display = 'none' }} />
      )}

      <div className="p-4 space-y-3">
        {/* Name + type */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-black text-base leading-tight" style={{ color: '#7a4900' }}>{p.name}</h3>
            {(p.area || p.city) && (
              <p className="text-xs mt-0.5" style={{ color: '#73775b' }}>{p.area || p.city}</p>
            )}
          </div>
          <TypeBadge type={p.type} />
        </div>

        {/* No star rating here on purpose. The numbers that used to sit here
            were Google's, taken from a scrape rather than the Maps API, and
            republishing them outside Google Maps is not ours to do — quite
            apart from showing someone else's measurement as though Pippy had
            made it. The maps link below sends people to the ratings instead of
            copying them. */}

        {/* Description */}
        {p.description && (
          <p className="text-sm leading-relaxed" style={{ color: '#7a4900' }}>{p.description}</p>
        )}

        {/* Details */}
        <div className="space-y-1.5">
          {p.address && (
            <div className="flex items-start gap-2 text-xs" style={{ color: '#73775b' }}>
              <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{p.address}</span>
            </div>
          )}
          {p.hours && (
            <div className="flex items-start gap-2 text-xs" style={{ color: '#73775b' }}>
              <Clock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{p.hours}</span>
            </div>
          )}
          {p.phone && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#73775b' }}>
              <Phone className="w-3.5 h-3.5 flex-shrink-0" />
              <a href={`tel:${p.phone}`} className="hover:underline">{p.phone}</a>
            </div>
          )}
        </div>

        {/* What this business does, and what it specialises in. A provider with
            neither shows neither — `type` alone can't say that a boarder also
            walks and trains, which is why these exist. */}
        {(p.services?.length > 0 || p.specializations?.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {(p.specializations || []).map(x => (
              <span key={x} className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#dceff5', color: '#255d6e' }}>{x}</span>
            ))}
            {(p.services || []).filter(x => x !== TYPE_CONFIG[p.type]?.label).map(x => (
              <span key={x} className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#f5f0e0', color: '#5f624b' }}>{x}</span>
            ))}
          </div>
        )}

        {isBoarder && <BoardingRequirements provider={p} />}
        <VisitPrep type={p.type} />

        {isBoarder && onPrepForStay && (
          <button onClick={() => onPrepForStay(p)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-105"
            style={{ backgroundColor: '#ffde59', color: '#7a4900' }}>
            <ClipboardCheck className="w-4 h-4" />
            Prep for a stay here
          </button>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-105"
              style={{ backgroundColor: '#25D366', color: 'white' }}>
              <MessageCircle className="w-4 h-4" />
              Message
            </a>
          )}
          {p.maps_url && (
            <a href={p.maps_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-105"
              style={{ backgroundColor: '#ebe3d3', color: '#7a4900' }}>
              <ExternalLink className="w-4 h-4" />
              Map
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProviderDirectory({ onPrepForStay }) {
  const [providers, setProviders] = useState([])
  const [total, setTotal]         = useState(0)
  const [facets, setFacets]       = useState({ total: 0, types: {}, areas: [] })
  const [loading, setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]         = useState(null)
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All')
  const [activeArea, setActiveArea] = useState('All')

  // Don't fire a query on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useMemo(() => ({
    type:   activeTab === 'All' ? null : activeTab,
    area:   activeArea === 'All' ? null : activeArea,
    search: debouncedSearch,
  }), [activeTab, activeArea, debouncedSearch])

  // Tab counts and the area dropdown need totals across the whole table, so
  // they come from a dedicated facets query rather than the current page.
  useEffect(() => {
    getProviderFacets({ area: query.area })
      .then(setFacets)
      .catch(e => setError(e.message))
  }, [query.area])

  // First page — refetched whenever a filter changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProviders({ ...query, offset: 0, limit: PAGE_SIZE })
      .then(({ rows, count }) => {
        if (cancelled) return
        setProviders(rows)
        setTotal(count)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const { rows } = await getProviders({ ...query, offset: providers.length, limit: PAGE_SIZE })
      setProviders(prev => [...prev, ...rows])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const q = debouncedSearch.trim()
  const areaOf = p => (p.area || p.city || '').trim()

  const areaOptions = facets.areas || []

  const tabCounts = useMemo(() => {
    const counts = { All: facets.total || 0 }
    for (const cat of CATEGORIES) counts[cat] = facets.types?.[cat] ?? 0
    return counts
  }, [facets])

  // Rows arrive already ordered by area then name, so grouping is just a
  // matter of starting a new section each time the area changes.
  const groupedByArea = useMemo(() => {
    const groups = []
    for (const p of providers) {
      const raw = areaOf(p)
      const key = raw ? raw.toLowerCase() : OTHER_KEY
      const last = groups[groups.length - 1]
      if (last && last.key === key) last.items.push(p)
      else groups.push({ key, label: raw ? toTitleCase(raw) : 'Other / Unspecified', items: [p] })
    }
    return groups
  }, [providers])

  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab
  const hasMore = providers.length < total

  return (
    <div className="min-h-full" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-black" style={{ color: '#7a4900' }}>Find Services 🐾</h1>
          <p className="text-sm mt-1" style={{ color: '#73775b' }}>Vets, groomers, stores and boarding near you</p>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap mb-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="px-3 py-1.5 rounded-full text-sm font-semibold transition-all"
              style={activeTab === t.id
                ? { backgroundColor: t.bg, color: t.color }
                : { backgroundColor: '#f5f0e0', color: '#73775b' }}
            >
              {t.label} ({tabCounts[t.id] ?? 0})
            </button>
          ))}
        </div>

        {/* Search + area filter */}
        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#73775b' }} />
            <input type="text" className="input w-full pl-9"
              placeholder="Search by name, area or service…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {areaOptions.length > 1 && (
            <select className="input w-36 flex-shrink-0 text-sm"
              value={activeArea} onChange={e => setActiveArea(e.target.value)}>
              <option value="All">All areas</option>
              {areaOptions.map(({ area, count }) => (
                <option key={area} value={area}>{area} ({count})</option>
              ))}
            </select>
          )}
        </div>

        {/* Loading / error */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#73775b' }}>
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-xl text-sm"
            style={{ backgroundColor: '#fdeaea', color: '#c0392b' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* ── Grouped by area ──────────────────────────────────────────────── */}
        {!loading && !error && (
          groupedByArea.length === 0 ? (
            <div className="text-center py-16">
              {q ? (
                <>
                  <Search className="w-10 h-10 mx-auto mb-3 opacity-20" style={{ color: '#7a4900' }} />
                  <p className="font-bold" style={{ color: '#7a4900' }}>No results for "{search}"</p>
                  <p className="text-sm mt-1" style={{ color: '#73775b' }}>Try a different name or area.</p>
                </>
              ) : (
                <p className="text-sm" style={{ color: '#73775b' }}>
                  No {activeTabLabel.toLowerCase()}{activeTab !== 'All' ? 's' : ' providers'} listed here yet
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs font-bold mb-4" style={{ color: '#73775b' }}>
                {total.toLocaleString('en-IN')} {total === 1 ? 'provider' : 'providers'}
                {q ? ` matching "${search.trim()}"` : ''}
              </p>

              <div className="space-y-8">
                {groupedByArea.map((g, i) => (
                  <div key={`${g.key}-${i}`}>
                    <div className="flex items-center gap-2.5 mb-3">
                      <h2 className="font-black text-base" style={{ color: '#7a4900' }}>{g.label}</h2>
                      <div className="flex-1 h-px" style={{ backgroundColor: '#ebe3d3' }} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {g.items.map(p => <ProviderCard key={p.id} p={p} onPrepForStay={onPrepForStay} />)}
                    </div>
                  </div>
                ))}
              </div>

              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full mt-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                  style={{ backgroundColor: '#fff3c0', color: '#7a4900', opacity: loadingMore ? 0.6 : 1 }}
                >
                  {loadingMore
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                    : `Show more (${(total - providers.length).toLocaleString('en-IN')} left)`}
                </button>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}
