import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Check, ClipboardCheck, MapPin, Loader2 } from 'lucide-react'
import { rankMatches } from '../lib/fuzzy.js'
import { hasCustomPolicy } from '../lib/boarding.js'

// Type-ahead over the boarder list. People remember a boarder's name
// imperfectly, so this ranks on how the name sounds as well as how it is
// spelled — see fuzzy.js. A plain <select> would make them scroll a few
// hundred rows to find one they could describe in three letters.
export default function BoarderSearch({
  boarders, value, valueName, onSelect, onClear,
  loading = false,
  placeholder = 'Search for a boarder by name…',
  allowUnlisted = true,
}) {
  const [query, setQuery]     = useState('')
  const [open, setOpen]       = useState(false)
  const [cursor, setCursor]   = useState(0)
  const boxRef   = useRef(null)
  const inputRef = useRef(null)

  const selected = useMemo(
    () => boarders.find(b => b.id === value) || null,
    [boarders, value])

  const results = useMemo(
    () => rankMatches(query, boarders, b => [b.name, b.area, b.city].filter(Boolean).join(' '), { limit: 8 }),
    [query, boarders])

  useEffect(() => { setCursor(0) }, [query])

  // Click-away closes the list without committing anything.
  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function choose(b) {
    onSelect(b)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter')   { e.preventDefault(); if (results[cursor]) choose(results[cursor].item) }
    else if (e.key === 'Escape')  { setOpen(false); inputRef.current?.blur() }
  }

  // Something already chosen — show it as a chip rather than an empty box the
  // user has to re-type into to understand what is selected.
  if (selected || (valueName && !open)) {
    const name = selected?.name || valueName
    const custom = selected ? hasCustomPolicy(selected) : false
    return (
      <div className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ backgroundColor: '#fff9e0', border: '1.5px solid #f2b83d' }}>
        <ClipboardCheck className="w-4 h-4 flex-shrink-0" style={{ color: '#c9891f' }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>{name}</div>
          <div className="text-xs truncate" style={{ color: '#73775b' }}>
            {selected?.area ? `${selected.area} · ` : ''}
            {custom ? 'Their own requirements' : 'General requirements'}
          </div>
        </div>
        <button onClick={onClear} aria-label="Choose a different boarder"
          className="p-1 rounded-lg flex-shrink-0 hover:bg-white/60 transition-colors"
          style={{ color: '#73775b' }}>
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: '#73775b' }} />
      <input
        ref={inputRef}
        className="input w-full pl-9"
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list" />

      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: '#73775b' }} />
      )}

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-2xl overflow-hidden shadow-lg"
          style={{ backgroundColor: '#FFFEF8', border: '1.5px solid #ebe3d3', maxHeight: '18rem', overflowY: 'auto' }}
          role="listbox">

          {results.map(({ item }, i) => {
            const custom = hasCustomPolicy(item)
            return (
              <button key={item.id}
                onClick={() => choose(item)}
                onMouseEnter={() => setCursor(i)}
                role="option"
                aria-selected={i === cursor}
                className="w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors"
                style={{ backgroundColor: i === cursor ? '#fff9e0' : 'transparent' }}>
                <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#73775b' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate" style={{ color: '#7a4900' }}>{item.name}</div>
                  <div className="text-xs truncate" style={{ color: '#73775b' }}>
                    {[item.area, item.city].filter(Boolean).join(' · ') || 'Location not listed'}
                  </div>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap"
                  style={custom
                    ? { backgroundColor: '#eef3e2', color: '#44562a' }
                    : { backgroundColor: '#f5f0e0', color: '#5f624b' }}>
                  {custom ? 'Own rules' : 'General'}
                </span>
              </button>
            )
          })}

          {query && results.length === 0 && (
            <p className="px-3 py-3 text-sm" style={{ color: '#73775b' }}>
              Nothing close to “{query}”.
              {allowUnlisted && ' You can still prep against the general requirements below.'}
            </p>
          )}

          {!boarders.length && !loading && (
            <p className="px-3 py-3 text-sm" style={{ color: '#73775b' }}>
              No boarders listed yet — prep against the general requirements instead.
            </p>
          )}

          {allowUnlisted && boarders.length > 0 && (
            <button onClick={() => { onClear(); setQuery(''); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm font-bold"
              style={{ borderTop: '1px solid #ebe3d3', color: '#255d6e' }}>
              <Check className="w-3.5 h-3.5" /> My boarder isn’t listed
            </button>
          )}
        </div>
      )}
    </div>
  )
}
