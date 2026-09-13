import { useEffect, useState, useMemo } from 'react'
import { Search, MapPin, Phone, Clock, ExternalLink, MessageCircle, Stethoscope, Scissors, ShoppingBag, Home, Camera, Flower2, Star, Loader2, AlertCircle } from 'lucide-react'
// MapPin used in ProviderCard address row
import { getProviders } from '../lib/storage.js'

const TYPE_CONFIG = {
  Vet:      { icon: Stethoscope, color: '#2563EB', bg: '#EFF6FF', label: 'Vet Clinic' },
  Groomer:  { icon: Scissors,    color: '#7C3AED', bg: '#F5F3FF', label: 'Groomer' },
  Store:    { icon: ShoppingBag, color: '#059669', bg: '#F0FDF4', label: 'Pet Store' },
  Boarder:  { icon: Home,        color: '#D97706', bg: '#FFFBEB', label: 'Boarding' },
  'Special Services':             { icon: Camera,  color: '#DB2777', bg: '#FDF2F8', label: 'Special Services' },
  'Pet Loss & Memorial Services': { icon: Flower2, color: '#475569', bg: '#F1F5F9', label: 'Pet Loss & Memorial' },
}

const CATEGORIES = ['Vet', 'Groomer', 'Store', 'Boarder', 'Special Services', 'Pet Loss & Memorial Services']

const TABS = [
  { id: 'All', label: 'All', color: '#4A2C0A', bg: '#F0E6C8' },
  ...CATEGORIES.map(id => ({ id, ...TYPE_CONFIG[id] })),
]

const OTHER_KEY = '__other__'
const PREVIEW_PER_AREA = 6

function toTitleCase(s) {
  return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

function TypeBadge({ type }) {
  const cfg = TYPE_CONFIG[type] || { color: '#6B7280', bg: '#F9FAFB', label: type }
  const Icon = cfg.icon || ShoppingBag
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  )
}

function ProviderCard({ p }) {
  const waNumber = p.whatsapp?.replace(/\D/g, '') || p.phone?.replace(/\D/g, '')
  const waLink   = waNumber ? `https://wa.me/${waNumber}` : null

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #F0E6C8' }}>

      {/* Photo */}
      {p.photo_url && (
        <img src={p.photo_url} alt={p.name} loading="lazy"
          className="w-full h-36 object-cover"
          onError={e => { e.currentTarget.style.display = 'none' }} />
      )}

      <div className="p-4 space-y-3">
        {/* Name + type */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-black text-base leading-tight" style={{ color: '#4A2C0A' }}>{p.name}</h3>
            {(p.area || p.city) && (
              <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>{p.area || p.city}</p>
            )}
          </div>
          <TypeBadge type={p.type} />
        </div>

        {/* Google rating */}
        {p.rating != null && (
          <div className="flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#F59E0B', fill: '#F59E0B' }} />
            <span className="text-sm font-black" style={{ color: '#4A2C0A' }}>{Number(p.rating).toFixed(1)}</span>
            {p.reviews_count != null && (
              <span className="text-xs" style={{ color: '#B8A080' }}>({p.reviews_count.toLocaleString('en-IN')})</span>
            )}
          </div>
        )}

        {/* Description */}
        {p.description && (
          <p className="text-sm leading-relaxed" style={{ color: '#6B4C1E' }}>{p.description}</p>
        )}

        {/* Details */}
        <div className="space-y-1.5">
          {p.address && (
            <div className="flex items-start gap-2 text-xs" style={{ color: '#B8A080' }}>
              <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{p.address}</span>
            </div>
          )}
          {p.hours && (
            <div className="flex items-start gap-2 text-xs" style={{ color: '#B8A080' }}>
              <Clock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{p.hours}</span>
            </div>
          )}
          {p.phone && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#B8A080' }}>
              <Phone className="w-3.5 h-3.5 flex-shrink-0" />
              <a href={`tel:${p.phone}`} className="hover:underline">{p.phone}</a>
            </div>
          )}
        </div>

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
              style={{ backgroundColor: '#F0E6C8', color: '#4A2C0A' }}>
              <ExternalLink className="w-4 h-4" />
              Map
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProviderDirectory() {
  const [providers, setProviders] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [search, setSearch]       = useState('')
  const [activeTab, setActiveTab] = useState('All')
  const [activeArea, setActiveArea] = useState('All')
  const [expanded, setExpanded]   = useState({})   // area key -> show all cards

  useEffect(() => {
    getProviders(true)
      .then(setProviders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const q = search.toLowerCase().trim()

  const areaOf = p => (p.area || p.city || '').trim()

  // Every area that has at least one provider, most-populated first
  const areaOptions = useMemo(() => {
    const counts = new Map()
    for (const p of providers) {
      const a = areaOf(p)
      if (a) counts.set(a, (counts.get(a) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([area, count]) => ({ area, count }))
  }, [providers])

  // Providers in the active tab + area (before search)
  const tabFiltered = useMemo(() => {
    let list = activeTab === 'All' ? providers : providers.filter(p => p.type === activeTab)
    if (activeArea !== 'All') list = list.filter(p => areaOf(p) === activeArea)
    return list
  }, [providers, activeTab, activeArea])

  // Counts per tab, independent of search — used for chip labels
  const tabCounts = useMemo(() => {
    const counts = { All: providers.length }
    for (const cat of CATEGORIES) counts[cat] = providers.filter(p => p.type === cat).length
    return counts
  }, [providers])

  // Search filters within the active tab (not a flat cross-category override)
  const searchedList = useMemo(() => {
    if (!q) return tabFiltered
    return tabFiltered.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.area?.toLowerCase().includes(q) ||
      p.city?.toLowerCase().includes(q) ||
      p.type?.toLowerCase().includes(q) ||
      p.address?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.categories?.some(c => c.toLowerCase().includes(q)))
  }, [tabFiltered, q])

  // Group by area (locality), "Other / Unspecified" always last. Within a
  // group the best-rated providers come first, unrated ones at the bottom.
  const groupedByArea = useMemo(() => {
    const map = new Map()

    for (const p of searchedList) {
      const raw = areaOf(p)
      const key = raw ? raw.toLowerCase() : OTHER_KEY
      if (!map.has(key)) {
        map.set(key, { key, label: raw ? toTitleCase(raw) : 'Other / Unspecified', items: [] })
      }
      map.get(key).items.push(p)
    }

    const groups = Array.from(map.values())

    groups.sort((a, b) => {
      if (a.key === OTHER_KEY) return 1
      if (b.key === OTHER_KEY) return -1
      return b.items.length - a.items.length || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    })

    for (const g of groups) {
      g.items.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (a.name || '').localeCompare(b.name || ''))
    }

    return groups
  }, [searchedList])

  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab

  return (
    <div className="min-h-full" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-black" style={{ color: '#4A2C0A' }}>Find Services 🐾</h1>
          <p className="text-sm mt-1" style={{ color: '#B8A080' }}>Vets, groomers, stores and boarding near you</p>
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
                : { backgroundColor: '#F5F0E0', color: '#B8A080' }}
            >
              {t.label} ({tabCounts[t.id] ?? 0})
            </button>
          ))}
        </div>

        {/* Search + area filter */}
        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#B8A080' }} />
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
          <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#B8A080' }}>
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-xl text-sm"
            style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* ── Grouped by area ──────────────────────────────────────────────── */}
        {!loading && !error && (
          groupedByArea.length === 0 ? (
            <div className="text-center py-16">
              {q ? (
                <>
                  <Search className="w-10 h-10 mx-auto mb-3 opacity-20" style={{ color: '#4A2C0A' }} />
                  <p className="font-bold" style={{ color: '#4A2C0A' }}>No results for "{search}"</p>
                  <p className="text-sm mt-1" style={{ color: '#B8A080' }}>Try a different name or area.</p>
                </>
              ) : (
                <p className="text-sm" style={{ color: '#B8A080' }}>
                  No {activeTabLabel.toLowerCase()}{activeTab !== 'All' ? 's' : ' providers'} listed here yet
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {groupedByArea.map(g => {
                // Keep the "all areas" view scannable — show a handful per area
                // until the reader asks for the rest.
                const collapsible = !expanded[g.key] && activeArea === 'All' && !q && g.items.length > PREVIEW_PER_AREA
                const visible = collapsible ? g.items.slice(0, PREVIEW_PER_AREA) : g.items
                return (
                <div key={g.key}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <h2 className="font-black text-base" style={{ color: '#4A2C0A' }}>{g.label}</h2>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#F0E6C8', color: '#4A2C0A' }}>
                      {g.items.length}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: '#F0E6C8' }} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {visible.map(p => <ProviderCard key={p.id} p={p} />)}
                  </div>
                  {collapsible && (
                    <button
                      onClick={() => setExpanded(e => ({ ...e, [g.key]: true }))}
                      className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold transition-all"
                      style={{ backgroundColor: '#FFF5AA', color: '#4A2C0A' }}
                    >
                      Show all {g.items.length} in {g.label}
                    </button>
                  )}
                </div>
              )})}
            </div>
          )
        )}
      </div>
    </div>
  )
}
