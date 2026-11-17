// Where /api lives, on the web and inside the app. Run: npm run test:api-base
//
// Capacitor serves the bundle from capacitor://localhost (iOS) or
// http://localhost (Android), so a relative "/api/x" resolves to a file in the
// app that does not exist. Twelve call sites used relative paths; they now go
// through one function.
//
// The web half matters as much as the native half. Hard-coding production
// would send every PREVIEW deployment's calls to the live site -- so a change
// to an endpoint could never be tested before it shipped, and a preview of a
// destructive endpoint would act on real data.

let pass = 0, fail = 0
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}`) }
}

// The module reads import.meta.env at load, so each configuration needs its
// own import. A query string is enough to defeat the module cache.
let n = 0
const load = async base => {
  if (base === null) delete process.env.VITE_API_BASE_URL
  else process.env.VITE_API_BASE_URL = base
  return import(`../src/lib/apiBase.js?case=${n++}`)
}

// Minimal stand-ins for the three shells this runs in.
const web      = { location: { protocol: 'https:' } }
// The REAL Android configuration. capacitor.config.json sets
// androidScheme: "https", so the bundle is served from https://localhost --
// a protocol the backstop below deliberately does not catch, because a plain
// web page uses it too. On Android, detection rests entirely on Capacitor
// having injected itself, which is the case this pins.
const android  = { location: { protocol: 'https:', hostname: 'localhost' },
                   Capacitor: { isNativePlatform: () => true } }
const ios      = { location: { protocol: 'capacitor:' } }
const iosCap   = { location: { protocol: 'capacitor:' }, Capacitor: { isNativePlatform: () => true } }
const fileUrl  = { location: { protocol: 'file:' } }

console.log('\nTelling the app apart from a browser tab')
{
  const { isNativeShell } = await load('https://pippypets.com')
  ok('a normal page is not native', isNativeShell(web) === false)
  ok('Capacitor saying so is enough, even over https', isNativeShell(android) === true)
  // The inverse, and the reason the protocol list stops where it does: a real
  // web page is also https, so protocol alone must never imply native.
  ok('https alone is not native',
     isNativeShell({ location: { protocol: 'https:', hostname: 'localhost' } }) === false)
  // The protocol check is the backstop: a WebView is native whatever else is
  // or is not on window, and a wrong answer here is a feature that works
  // everywhere except the app nobody can debug.
  ok('the capacitor: scheme is enough on its own', isNativeShell(ios) === true)
  ok('so is file:', isNativeShell(fileUrl) === true)
  ok('both together still native', isNativeShell(iosCap) === true)
  ok('no window at all is not native', isNativeShell(undefined) === false)
  ok('a window with no location does not throw', isNativeShell({}) === false)
  // Capacitor's own flag is authoritative when it says false: the web build
  // served over https from the real site must never be treated as native.
  ok('isNativePlatform() false is not native',
     isNativeShell({ location: { protocol: 'https:' }, Capacitor: { isNativePlatform: () => false } }) === false)
}

console.log('\nOn the web, paths stay relative')
{
  const { apiUrl, apiBase } = await load('https://pippypets.com')
  // Even with a base configured. This is the assertion that protects preview
  // deployments from calling production.
  ok('a relative path is left alone', apiUrl('/api/ai-complete', web) === '/api/ai-complete')
  ok('query strings survive',
     apiUrl('/api/provider-mail?op=inform', web) === '/api/provider-mail?op=inform')
  ok('the base is empty', apiBase(web) === '')
}

console.log('\nIn the app, paths are made absolute')
{
  const { apiUrl, apiBase } = await load('https://pippypets.com')
  ok('android', apiUrl('/api/ai-complete', android) === 'https://pippypets.com/api/ai-complete')
  ok('ios', apiUrl('/api/ai-complete', ios) === 'https://pippypets.com/api/ai-complete')
  ok('query strings survive',
     apiUrl('/api/provider-mail?op=inform', ios) === 'https://pippypets.com/api/provider-mail?op=inform')
  ok('the base is the configured host', apiBase(ios) === 'https://pippypets.com')
}

console.log('\nJoining without doubling or dropping a slash')
{
  const { apiUrl } = await load('https://pippypets.com/')
  ok('a trailing slash on the base is trimmed',
     apiUrl('/api/x', ios) === 'https://pippypets.com/api/x', apiUrl('/api/x', ios))

  const { apiUrl: u2 } = await load('https://pippypets.com///')
  ok('several are trimmed too', u2('/api/x', ios) === 'https://pippypets.com/api/x', u2('/api/x', ios))

  const { apiUrl: u3 } = await load('https://pippypets.com')
  ok('a path missing its slash still joins', u3('api/x', ios) === 'https://pippypets.com/api/x', u3('api/x', ios))
}

console.log('\nWhat it refuses to touch')
{
  const { apiUrl } = await load('https://pippypets.com')
  // A caller with its own reason to name a host is not second-guessed.
  ok('an absolute http URL is returned as-is',
     apiUrl('https://example.com/api/x', ios) === 'https://example.com/api/x')
  ok('case does not fool it',
     apiUrl('HTTPS://example.com/api/x', ios) === 'HTTPS://example.com/api/x')
  ok('empty input does not throw', apiUrl('', ios) === '')
  ok('undefined does not throw', apiUrl(undefined, ios) === '')
}

console.log('\nA native build with no base configured')
{
  const { apiUrl, nativeApiMisconfigured } = await load(null)
  // It cannot invent a host. What it must not do is pretend this is fine:
  // the failure is every network feature at once, and the error the user sees
  // blames their connection rather than the build that forgot a variable.
  ok('it is reported as misconfigured', nativeApiMisconfigured(ios) === true)
  ok('the web is never misconfigured', nativeApiMisconfigured(web) === false)
  ok('and the path is left relative rather than mangled', apiUrl('/api/x', ios) === '/api/x')
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
