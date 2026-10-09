// Run: npm run test:money
//
// Two bugs on one line of the health timeline, found by walking the product:
// a rupee amount printed with a DOLLAR sign, and the word "undefined" printed
// for a nullable field that had no separator in front of it to hang a guard
// on. Both are now this module's job, so both are pinned here.
import { rupees, detailLine } from '../src/lib/money.js'
let f = 0
const ck = (l,g,w) => { const ok = JSON.stringify(g)===JSON.stringify(w); if(!ok) f++
  console.log(`${ok?'ok   ':'FAIL '} ${l.padEnd(46)} ${JSON.stringify(g)}`) }

// ── rupees ────────────────────────────────────────────────────────────────
ck('a plain amount',              rupees(2400),      '₹2,400')
// Indian grouping, which is the whole reason not to use the default locale.
ck('lakhs group the Indian way',  rupees(240000),    '₹2,40,000')
ck('and so do crores',            rupees(12500000),  '₹1,25,00,000')
ck('paise are kept when present', rupees(99.5),      '₹99.5')
ck('zero is a real amount',       rupees(0),         '₹0')
ck('a numeric string works',      rupees('2400'),    '₹2,400')
// Not a number is not "₹NaN" — it is nothing, and the caller drops the part.
ck('null is nothing',             rupees(null),      null)
ck('undefined is nothing',        rupees(undefined), null)
ck('nonsense is nothing',         rupees('abc'),     null)

// ── detailLine ────────────────────────────────────────────────────────────
ck('all three parts',     detailLine('Checkup','Dr Rao','₹2,400'), 'Checkup · Dr Rao · ₹2,400')
// The bug: a missing FIRST field used to print the word "undefined".
ck('a missing type',      detailLine(undefined,'Dr Rao','₹2,400'), 'Dr Rao · ₹2,400')
ck('a null type',         detailLine(null,'Dr Rao'),               'Dr Rao')
ck('an empty type',       detailLine('','Dr Rao'),                 'Dr Rao')
ck('nothing at all',      detailLine(null,undefined,''),           '')
// Zero must survive: "0 reactions" is a thing, 0 is not absence.
ck('zero is kept',        detailLine(0,'Dr Rao'),                  '0 · Dr Rao')
ck('no "undefined" ever', /undefined/.test(detailLine(undefined,null,'x')), false)

console.log(f ? `\n${f} failed` : '\nmoney reads in rupees')
process.exit(f ? 1 : 0)
