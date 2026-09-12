import { useEffect, useState } from 'react'
import { Search, MapPin, Phone, Clock, ExternalLink, MessageCircle, Stethoscope, Scissors, ShoppingBag, Home, Loader2, AlertCircle } from 'lucide-react'
// MapPin used in ProviderCard address row
import { getProviders } from '../lib/storage.js'

const TYPE_CONFIG = {
  Vet:     { icon: Stethoscope, color: '#2563EB', bg: '#EFF6FF', label: 'Vet Clinic' },
  Groomer: { icon: Scissors,    color: '#7C3AED', bg: '#F5F3FF', label: 'Groomer' },
  Store:   { icon: ShoppingBag, color: '#059669', bg: '#F0FDF4', label: 'Pet Store' },
  Boarder: { icon: Home,        color: '#D97706', bg: '#FFFBEB', label: 'Boarding' },
}

const CATEGORIES = ['Vet', 'Groomer', 'Store', 'Boarder']

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
        <img src={p.photo_url} alt={p.name}
          className="w-full h-36 object-cover"
          onError={e => { e.currentTarget.style.display = 'none' }} />
      )}

      <div className="p-4 space-y-3">
        {/* Name + type */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-black text-base leading-tight" style={{ color: '#4A2C0A' }}>{p.name}</h3>
            {p.city && <p className="text-xs mt-0.5" style={{ color: '#B8A080' }}>{p.city}</p>}
          </div>
          <TypeBadge type={p.type} />
        </div>

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

  useEffect(() => {
    getProviders(true)
      .then(setProviders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const q = search.toLowerCase().trim()

  // When searching: flat filtered list. When not: grouped by category.
  const searchResults = q
    ? providers.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.city?.toLowerCase().includes(q) ||
        p.type?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q))
    : []

  const byCategory = CATEGORIES.map(cat => ({
    cat,
    cfg: TYPE_CONFIG[cat],
    items: providers.filter(p => p.type === cat),
  }))

  return (
    <div className="min-h-full" style={{ backgroundColor: '#FFFEF8' }}>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-black" style={{ color: '#4A2C0A' }}>Find Services 🐾</h1>
          <p className="text-sm mt-1" style={{ color: '#B8A080' }}>Vets, groomers, stores and boarding near you</p>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#B8A080' }} />
          <input type="text" className="input w-full pl-9"
            placeholder="Search by name, city or type…"
            value={search} onChange={e => setSearch(e.target.value)} />
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

        {/* ── Search results (flat) ─────────────────────────────────────── */}
        {!loading && !error && q && (
          <>
            {searchResults.length === 0 ? (
              <div className="text-center py-16">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-20" style={{ color: '#4A2C0A' }} />
                <p className="font-bold" style={{ color: '#4A2C0A' }}>No results for "{search}"</p>
                <p className="text-sm mt-1" style={{ color: '#B8A080' }}>Try a different name or city.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {searchResults.map(p => <ProviderCard key={p.id} p={p} />)}
              </div>
            )}
          </>
        )}

        {/* ── Grouped by category ───────────────────────────────────────── */}
        {!loading && !error && !q && (
          <div className="space-y-8">
            {byCategory.map(({ cat, cfg, items }) => {
              const Icon = cfg.icon
              return (
                <div key={cat}>
                  {/* Section header */}
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: cfg.bg }}>
                      <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                    </div>
                    <h2 className="font-black text-base" style={{ color: '#4A2C0A' }}>
                      {cfg.label}s
                    </h2>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                      {items.length}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: '#F0E6C8' }} />
                  </div>

                  {items.length === 0 ? (
                    <div className="rounded-2xl px-4 py-5 text-center"
                      style={{ backgroundColor: '#FAFAFA', border: '1.5px dashed #E5E0D5' }}>
                      <p className="text-sm" style={{ color: '#B8A080' }}>
                        No {cfg.label.toLowerCase()}s listed yet
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {items.map(p => <ProviderCard key={p.id} p={p} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
