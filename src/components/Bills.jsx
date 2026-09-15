import { useEffect, useState } from 'react'
import { Receipt, Plus, Trash2, ChevronDown, ChevronUp, X, TrendingUp } from 'lucide-react'
import { getBills, saveBill, deleteBill } from '../lib/storage.js'
import { format, parseISO, isValid } from 'date-fns'

const CURRENCIES = ['INR', 'USD', 'GBP', 'AUD', 'EUR', 'SGD']

function currencySymbol(c) {
  return { INR: '₹', USD: '$', GBP: '£', AUD: 'A$', EUR: '€', SGD: 'S$' }[c] || c
}

function fmt(amount, currency) {
  if (!amount && amount !== 0) return '—'
  return `${currencySymbol(currency)}${parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function parseDate(str) {
  if (!str) return null
  try { const d = parseISO(str); return isValid(d) ? d : null } catch { return null }
}

// ── Spend Analytics ───────────────────────────────────────────────────────────

function SpendChart({ bills, currency }) {
  if (bills.length === 0) return null

  // Group bills by YYYY-MM
  const byMonth = {}
  bills.forEach(b => {
    if (!b.date || !b.totalAmount) return
    const key = b.date.slice(0, 7)          // "2024-03"
    byMonth[key] = (byMonth[key] || 0) + parseFloat(b.totalAmount)
  })

  const months = Object.keys(byMonth).sort()
  if (months.length === 0) return null

  const maxVal = Math.max(...months.map(m => byMonth[m]))

  // Show last 6 months max
  const recent = months.slice(-6)

  function monthLabel(key) {
    const [y, m] = key.split('-')
    return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
  }

  return (
    <div className="card mb-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4" style={{ color: '#7a4900' }} />
        <span className="font-black text-sm" style={{ color: '#7a4900' }}>Monthly Spend</span>
      </div>

      {/* Bars */}
      <div className="flex items-end gap-2" style={{ height: 100 }}>
        {recent.map(m => {
          const val = byMonth[m]
          const pct = maxVal > 0 ? (val / maxVal) * 100 : 0
          return (
            <div key={m} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] font-bold leading-none" style={{ color: '#73775b' }}>
                {currencySymbol(currency)}{val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
              </span>
              <div className="w-full rounded-t-lg transition-all"
                style={{
                  height: `${Math.max(pct, 4)}%`,
                  backgroundColor: '#f2b83d',
                  minHeight: 4,
                }} />
            </div>
          )
        })}
      </div>

      {/* Month labels */}
      <div className="flex gap-2 mt-1">
        {recent.map(m => (
          <div key={m} className="flex-1 text-center">
            <span className="text-[9px]" style={{ color: '#73775b' }}>{monthLabel(m)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Add form ──────────────────────────────────────────────────────────────────

function AddBillForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    clinic: '', invoiceNumber: '', currency: 'INR', notes: '',
    lineItems: [{ description: '', amount: '' }],
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const total = form.lineItems.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  function setItem(idx, key, val) {
    setForm(f => ({
      ...f,
      lineItems: f.lineItems.map((r, i) => i === idx ? { ...r, [key]: val } : r)
    }))
  }

  function addRow() { setForm(f => ({ ...f, lineItems: [...f.lineItems, { description: '', amount: '' }] })) }
  function removeRow(idx) { setForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.clinic.trim() && !form.date) return
    setSaving(true)
    try {
      const items = form.lineItems.filter(r => r.description.trim() || r.amount)
      await onSave({ ...form, lineItems: items, totalAmount: total || null })
    } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ backgroundColor: '#fff9e0', borderColor: '#f2b83d' }}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-black text-sm" style={{ color: '#7a4900' }}>Add Bill / Invoice</span>
          <button type="button" onClick={onCancel}>
            <X className="w-4 h-4" style={{ color: '#73775b' }} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label text-xs">Clinic / Hospital</label>
            <input className="input" value={form.clinic} onChange={e => set('clinic', e.target.value)} placeholder="e.g. Animal Medical Services" />
          </div>
          <div>
            <label className="label text-xs">Date</label>
            <input type="date" className="input" value={form.date} onChange={e => set('date', e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">Invoice # (optional)</label>
            <input className="input" value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} placeholder="Bill number" />
          </div>
          <div>
            <label className="label text-xs">Currency</label>
            <select className="input" value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Line items */}
        <div>
          <label className="label text-xs mb-2 block">Line Items</label>
          <div className="space-y-2">
            {form.lineItems.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input className="input flex-1 text-sm" placeholder="Description" value={row.description}
                  onChange={e => setItem(i, 'description', e.target.value)} />
                <input className="input w-28 text-sm" placeholder="Amount" type="number" min="0" step="0.01"
                  value={row.amount} onChange={e => setItem(i, 'amount', e.target.value)} />
                {form.lineItems.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow}
            className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
            + Add line
          </button>
        </div>

        {/* Auto total */}
        {total > 0 && (
          <div className="flex justify-end">
            <span className="font-black text-lg" style={{ color: '#7a4900' }}>
              Total: {fmt(total, form.currency)}
            </span>
          </div>
        )}

        <div>
          <label className="label text-xs">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any other details..." />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Bill'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Bill card ─────────────────────────────────────────────────────────────────

function BillCard({ bill, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const d = parseDate(bill.date)

  return (
    <div className="card group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: '#fff3c0' }}>
            <Receipt className="w-4 h-4" style={{ color: '#7a4900' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm" style={{ color: '#7a4900' }}>
              {bill.clinic || 'Vet Clinic'}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {d && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
                  {format(d, 'MMM d, yyyy')}
                </span>
              )}
              {bill.invoiceNumber && (
                <span className="text-xs" style={{ color: '#73775b' }}>#{bill.invoiceNumber}</span>
              )}
            </div>
            {bill.totalAmount && (
              <p className="font-black text-base mt-1" style={{ color: '#7a4900' }}>
                {fmt(bill.totalAmount, bill.currency)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {bill.lineItems?.length > 0 && (
            <button onClick={() => setExpanded(v => !v)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: '#fff3c0', color: '#7a4900' }}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <button onClick={() => onDelete(bill.id)}
            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Line items */}
      {expanded && bill.lineItems?.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #ebe3d3' }}>
          <div className="space-y-1.5">
            {bill.lineItems.map((item, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span style={{ color: '#7a4900' }}>{item.description}</span>
                <span className="font-semibold" style={{ color: '#7a4900' }}>
                  {fmt(item.amount, bill.currency)}
                </span>
              </div>
            ))}
          </div>
          {bill.totalAmount && (
            <div className="flex justify-between mt-2 pt-2 font-black text-sm"
              style={{ borderTop: '1px solid #ebe3d3', color: '#7a4900' }}>
              <span>Total</span>
              <span>{fmt(bill.totalAmount, bill.currency)}</span>
            </div>
          )}
        </div>
      )}

      {bill.notes && (
        <p className="text-xs mt-2 italic" style={{ color: '#73775b' }}>{bill.notes}</p>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Bills({ pet }) {
  const [bills, setBills] = useState([])
  const [showForm, setShowForm] = useState(false)

  function load() { getBills(pet.id).then(setBills).catch(console.error) }
  useEffect(load, [pet.id])

  async function handleSave(form) {
    await saveBill({ ...form, petId: pet.id })
    setShowForm(false)
    load()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this bill?')) return
    await deleteBill(id)
    load()
  }

  // Total spent
  const totalSpent = bills.reduce((s, b) => s + (parseFloat(b.totalAmount) || 0), 0)
  const mainCurrency = bills[0]?.currency || 'INR'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black" style={{ color: '#7a4900' }}>Bills & Invoices</h2>
          {bills.length > 0 && (
            <p className="text-sm" style={{ color: '#73775b' }}>
              Total: <span className="font-bold" style={{ color: '#7a4900' }}>{fmt(totalSpent, mainCurrency)}</span>
              {' '}across {bills.length} bill{bills.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary gap-1.5 text-sm">
          <Plus className="w-4 h-4" /> Add Bill
        </button>
      </div>

      {/* Spend chart */}
      <SpendChart bills={bills} currency={mainCurrency} />

      {/* Add form */}
      {showForm && (
        <AddBillForm onSave={handleSave} onCancel={() => setShowForm(false)} />
      )}

      {/* Empty state */}
      {bills.length === 0 && !showForm && (
        <div className="card flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
            style={{ backgroundColor: '#fff3c0' }}>
            <Receipt className="w-8 h-8" style={{ color: '#7a4900' }} />
          </div>
          <p className="font-bold" style={{ color: '#7a4900' }}>No bills recorded</p>
          <p className="text-sm mt-1" style={{ color: '#73775b' }}>
            Add bills manually or scan a vet invoice to track expenses.
          </p>
        </div>
      )}

      {/* Bills list */}
      <div className="space-y-3">
        {bills.map(b => (
          <BillCard key={b.id} bill={b} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  )
}
