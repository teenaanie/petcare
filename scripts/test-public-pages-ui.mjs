// The two pages Google Play requires at a public URL.
// Run: npm run test:public-pages
//
// The requirement is precise: a privacy policy and account-deletion
// instructions that open WITHOUT installing the app and WITHOUT signing in.
// Pippy's privacy notice was a modal behind the sign-in screen, and
// /privacy returned 200 only because the SPA rewrite serves index.html to
// every unknown path — a status code that says nothing about whether the page
// exists. These assertions check for the words on the page, not the status.
//
// Skips without Playwright or a dev server, same contract as the others.

import fs from 'node:fs'
let chromium
try { ({ chromium } = await import('playwright')) }
catch { console.log('skipped — playwright is not installed'); process.exit(0) }
try {
  const probe = await fetch('http://localhost:5173/', { signal: AbortSignal.timeout(2000) })
  if (!probe.ok) throw new Error('bad status')
} catch { console.log('skipped — no dev server on :5173 (npm run dev)'); process.exit(0) }

const EXE = ['/opt/pw-browsers/chromium/chrome-linux/chrome',
             '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p))

let fails = 0
const ck = (l, got, want = true) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l.padEnd(58)} ${JSON.stringify(got)}`)
}

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {})
// A brand new visitor: no session, no storage, exactly what a reviewer has.
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(e.message))

console.log('\n/privacy — signed out, nothing installed')
await page.goto('http://localhost:5173/privacy', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
let body = await page.innerText('body')
ck('the policy itself is on the page', /Privacy\s*&?\s*Terms/i.test(body))
ck('it says what Pippy stores', /What Pippy stores/i.test(body))
ck('it names the processors', /Who else sees it/i.test(body))
// The failure this replaces: landing on the app instead of a policy.
ck('it is NOT the app landing page',
   /FOR EVERY PET YOU LOOK AFTER/i.test(body), false)
ck('and not the sign-in step either',
   await page.getByRole('button', { name: /^Send Code$/i }).count(), 0)
ck('no Close button, since there is nothing to close back to',
   await page.getByRole('button', { name: /^Close$/ }).count(), 0)

console.log('\n/delete-account — signed out, nothing installed')
await page.goto('http://localhost:5173/delete-account', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
body = await page.innerText('body')
// Play's three requirements for this page, checked one by one.
ck('it names the app and developer', /Pippy/.test(body) && /Teena Emmanuel/.test(body))
ck('it gives the steps', /Delete my account/i.test(body) && /sign in/i.test(body))
ck('it says what is deleted', /What is deleted/i.test(body))
ck('it says what is kept, and for how long', /What is kept/i.test(body) && /90 days/.test(body))
ck('it covers people who cannot open the app', /cannot open the app/i.test(body))
ck('it is NOT the app landing page',
   /FOR EVERY PET YOU LOOK AFTER/i.test(body), false)
ck('and not the sign-in step either',
   await page.getByRole('button', { name: /^Send Code$/i }).count(), 0)

console.log('\nThe app itself still works')
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
body = await page.innerText('body')
ck('the landing page is unchanged', /Pippy/.test(body) && !/What is deleted/i.test(body))
ck('no uncaught errors anywhere', errs, [])

await browser.close()
console.log(fails ? `\n${fails} FAILED\n` : '\nall passed\n')
process.exit(fails ? 1 : 0)
