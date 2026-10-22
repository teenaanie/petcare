// Editing what the AI thinks it heard or read.
//
// Every screen where a model proposes records -- the voice intake review, the
// document scanner -- needs the same thing: show the captured value, let the
// owner correct it before it is written, and never change it behind their
// back. This is that, once, so the three screens cannot drift.
//
// ── The trap this exists to close ────────────────────────────────────────────
//
// A <select> rendered over a value that is not one of its options does not
// show "nothing". The browser falls back to the FIRST option, so a scan that
// returned category "Painkiller" displayed "Deworming" while the state still
// held "Painkiller" -- the screen showed one thing and would have saved
// another, on the screen whose entire job is to let someone approve what gets
// saved. The value is therefore always added to its own option list.
//
// VoiceUpdate.jsx got this right first and said so in a comment; the scanner's
// own Field helper did not. Hence one copy.

/**
 * One captured field.
 *
 * @param {object}   spec   { field, label, type, options, placeholder, step, rows, required }
 * @param {*}        value
 * @param {Function} onChange  (nextValue) => void
 */
export function CapturedField({ spec, value, onChange, dense = false }) {
  const cls = `input w-full text-sm ${dense ? 'py-1' : 'py-1.5'}`
  const v = value ?? ''

  const label = (
    <span className="block text-[10px] font-black uppercase tracking-wider mb-0.5"
      style={{ color: '#a08f7a' }}>
      {spec.label}{spec.required ? ' *' : ''}
    </span>
  )

  // Some of these screens put rows inside a <label> wrapping a checkbox, so a
  // click in a field would toggle the tick underneath it.
  const stop = e => e.stopPropagation()

  if (spec.type === 'select') {
    // See the note at the top: the captured value joins its own options, or
    // rendering silently rewrites it to whichever option happens to be first.
    const options = [...new Set([...(spec.options || []), v].filter(Boolean))]
    return (
      <div>
        {label}
        <select className={cls} value={v} onClick={stop}
          onChange={e => onChange(e.target.value)}>
          <option value=""></option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }

  if (spec.type === 'textarea') {
    return (
      <div>
        {label}
        <textarea className={cls} rows={spec.rows || 2} value={v} onClick={stop}
          placeholder={spec.placeholder || ''}
          onChange={e => onChange(e.target.value)} />
      </div>
    )
  }

  return (
    <div>
      {label}
      <input className={cls} type={spec.type || 'text'} step={spec.step} value={v}
        placeholder={spec.placeholder || ''} onClick={stop}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

/**
 * A grid of captured fields.
 *
 * `values` is the record as it stands; `onChange(field, value)` reports one
 * edit. Nothing is written anywhere here -- these screens all save explicitly.
 */
export default function CapturedFields({ fields = [], values = {}, onChange, dense = false }) {
  if (!fields.length) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map(spec => (
        <div key={spec.field} className={spec.wide ? 'col-span-2' : ''}>
          <CapturedField spec={spec} value={values[spec.field]} dense={dense}
            onChange={next => onChange(spec.field, next)} />
        </div>
      ))}
    </div>
  )
}
