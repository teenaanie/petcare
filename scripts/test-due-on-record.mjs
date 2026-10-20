// Due dates that live on a vaccination or medicine record, not in `reminders`.
// Run: npm run test:due-on-record
//
// Why this exists: Daisy's Felocell was recorded on 28 Sep as due 20 Oct. On
// 20 Oct nothing was sent, because the morning job read only the `reminders`
// table and no row had ever been created for that date. The app showed a due
// date and then said nothing on the day.

process.env.SUPABASE_URL         = 'https://stub.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'service-stub'

const { dueOnRecord, nextDueDate } = await import('../api/_lib/morning-reminders.js')

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

const DAISY = { id: 'pet-daisy', name: 'Daisy', user_id: 'user-1' }
const PINO  = { id: 'pet-pino',  name: 'Pino',  user_id: 'user-1' }

// Only the two calls dueOnRecord makes, with the filters it applies, so the
// test fails if it stops applying them.
function db(tables) {
  const calls = []
  return {
    calls,
    from(table) {
      const q = { table, filters: {} }
      const chain = {
        select() { return chain },
        gte(c, v) { q.filters.gte = [c, v]; return chain },
        lte(c, v) { q.filters.lte = [c, v]; return chain },
        not(c, op, v) { q.filters.not = [c, op, v]; return chain },
        then(res) {
          calls.push(q)
          // Filtering is driven by the filters the caller actually asked for,
          // never hardcoded. A stub that enforces a rule the query forgot
          // makes the query's filters untestable: drop .not('is_done',...)
          // from the real code and a hardcoded stub still passes.
          const rows = (tables[table] || []).filter(r => {
            if (q.filters.not) {
              const [col, op, val] = q.filters.not
              if (op !== 'is') throw new Error('stub only models .not(col, "is", v)')
              if (r[col] === val) return false
            }
            if (q.filters.gte && !(r[q.filters.gte[0]] >= q.filters.gte[1])) return false
            if (q.filters.lte && !(r[q.filters.lte[0]] <= q.filters.lte[1])) return false
            return true
          })
          return Promise.resolve(tables[table] === undefined
            ? { data: null, error: { message: `no such table ${table}` } }
            : { data: rows, error: null }).then(res)
        },
      }
      return chain
    },
  }
}

const FROM = '2026-10-13', TODAY = '2026-10-20'

console.log('\nThe case that started this')
{
  const supabase = db({
    vaccinations: [{ id: 'v1', name: 'Felocell', next_due: '2026-10-20', notified_for_date: null, pet: DAISY }],
    medicines: [],
  })
  const out = await dueOnRecord(supabase, FROM, TODAY, [])

  ok('a vaccination due today is picked up', out.length === 1, out)
  ok('it names the vaccine, not just "Vaccination"',
     /Felocell/.test(out[0]?.notes || ''), out[0]?.notes)
  ok('it carries the pet through for grouping', out[0]?.pet?.id === DAISY.id, out[0]?.pet)
  ok('it says which table to mark afterwards', out[0]?._table === 'vaccinations', out[0]?._table)
  ok('it is shaped like a reminder the sender already understands',
     typeof out[0].type === 'string' && typeof out[0].due_date === 'string'
     && 'email' in out[0] && 'whatsapp' in out[0], out[0])
}

console.log('\nIt never goes out twice')
{
  const supabase = db({
    vaccinations: [{ id: 'v1', name: 'Felocell', next_due: '2026-10-20', notified_for_date: '2026-10-20', pet: DAISY }],
    medicines: [],
  })
  // The job looks back seven days to survive a missed run. Without this the
  // same due date would be mailed every morning for a week.
  ok('one already notified for that date is skipped',
     (await dueOnRecord(supabase, FROM, TODAY, [])).length === 0)
}

console.log('\nIt does not talk over a reminder the owner made')
{
  const supabase = db({
    vaccinations: [{ id: 'v1', name: 'Felocell', next_due: '2026-10-20', notified_for_date: null, pet: DAISY }],
    medicines: [],
  })
  const handMade = [{ id: 'r1', type: 'Vaccination', due_date: '2026-10-20', pet: DAISY }]
  ok('the same pet, day and kind is said once',
     (await dueOnRecord(supabase, FROM, TODAY, handMade)).length === 0)

  const otherDay = [{ id: 'r1', type: 'Vaccination', due_date: '2026-10-19', pet: DAISY }]
  ok('a reminder on a different day does not suppress it',
     (await dueOnRecord(supabase, FROM, TODAY, otherDay)).length === 1)

  const otherPet = [{ id: 'r1', type: 'Vaccination', due_date: '2026-10-20', pet: PINO }]
  ok('another pet\'s reminder does not suppress it',
     (await dueOnRecord(supabase, FROM, TODAY, otherPet)).length === 1)

  const otherKind = [{ id: 'r1', type: 'Medication', due_date: '2026-10-20', pet: DAISY }]
  ok('a different kind on the same day does not suppress it',
     (await dueOnRecord(supabase, FROM, TODAY, otherKind)).length === 1)
}

console.log('\nTwo records, same pet, same day')
{
  const supabase = db({
    vaccinations: [
      { id: 'v1', name: 'Felocell', next_due: '2026-10-20', notified_for_date: null, pet: DAISY },
      { id: 'v2', name: 'Felocell', next_due: '2026-10-20', notified_for_date: null, pet: DAISY },
    ],
    medicines: [],
  })
  ok('a duplicated record is said once', (await dueOnRecord(supabase, FROM, TODAY, [])).length === 1)
}

console.log('\nMedicines too — the column and the gap are identical')
{
  const supabase = db({
    vaccinations: [],
    medicines: [{ id: 'm1', name: 'Bravecto', next_due: '2026-10-18', notified_for_date: null, pet: PINO }],
  })
  const out = await dueOnRecord(supabase, FROM, TODAY, [])
  ok('a medicine due inside the window is picked up', out.length === 1, out)
  ok('it is filed as Medication', out[0]?.type === 'Medication', out[0]?.type)
  ok('it marks the medicines table', out[0]?._table === 'medicines', out[0]?._table)
}

console.log('\nWhat it leaves alone')
{
  const supabase = db({
    vaccinations: [
      { id: 'v1', name: 'Done already', next_due: '2026-10-20', is_done: true, notified_for_date: null, pet: DAISY },
      { id: 'v2', name: 'Future',       next_due: '2026-11-12', notified_for_date: null, pet: DAISY },
      { id: 'v3', name: 'Long past',    next_due: '2026-08-27', notified_for_date: null, pet: DAISY },
      { id: 'v4', name: 'No date',      next_due: null,         notified_for_date: null, pet: DAISY },
      { id: 'v5', name: 'Orphan',       next_due: '2026-10-20', notified_for_date: null, pet: null },
    ],
    medicines: [],
  })
  // A record whose pet has been deleted has nobody to notify and no name to
  // group under. It must be dropped, not crash the whole morning run.
  let out, threw = null
  try { out = await dueOnRecord(supabase, FROM, TODAY, []) } catch (e) { threw = e.message }
  ok('a record with no pet does not throw', threw === null, threw)
  ok('only the ones genuinely due are returned', out?.length === 0, out?.map(o => o.notes))
}

console.log('\nA record never rolls itself forward')
{
  // A booster interval is a clinical claim. The next date comes from the next
  // document, not from arithmetic on this one.
  ok("'Once' does not recur", nextDueDate('2026-10-20', 'Once', '2026-10-20') === null)
  ok('an ordinary reminder still does',
     nextDueDate('2026-10-20', 'Monthly', '2026-10-20') === '2026-11-20',
     nextDueDate('2026-10-20', 'Monthly', '2026-10-20'))
}

console.log('\nOne broken table does not cost the others their morning')
{
  const supabase = db({
    medicines: [{ id: 'm1', name: 'Bravecto', next_due: '2026-10-20', notified_for_date: null, pet: PINO }],
    // vaccinations deliberately absent -> the stub returns an error for it
  })
  const out = await dueOnRecord(supabase, FROM, TODAY, [])
  ok('the healthy table still reports', out.length === 1 && out[0]._table === 'medicines', out)
}

console.log('\nThe query actually filters')
{
  const supabase = db({ vaccinations: [], medicines: [] })
  await dueOnRecord(supabase, FROM, TODAY, [])
  const v = supabase.calls.find(c => c.table === 'vaccinations')
  ok('it asks for both record tables', supabase.calls.length === 2, supabase.calls.map(c => c.table))
  ok('bounded by the catch-up window, not the whole table',
     v?.filters.gte?.[1] === FROM && v?.filters.lte?.[1] === TODAY, v?.filters)
  ok('done records are excluded in the query, not merely in JS',
     JSON.stringify(v?.filters.not) === JSON.stringify(['is_done', 'is', true]), v?.filters.not)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
