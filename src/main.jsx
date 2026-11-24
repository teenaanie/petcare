import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ProviderRegistration from './components/ProviderRegistration.jsx'
import './index.css'
import { installErrorReporting } from './lib/errorReport.js'
import { installAwayInvalidation } from './lib/storage.js'

// Before render, so a fault during the first paint is still reported.
installErrorReporting()

// Coming back to a tab left open since this morning should not be served rows
// cached before you edited the same pet on your phone. This only clears the
// cache -- it deliberately does not re-render an open tab, which would discard
// a half-filled form. See src/lib/readCache.js.
installAwayInvalidation()

const path = window.location.pathname.replace(/\/+$/, '')

const isRegisterRoute = path === '/register-provider'
// Everything under /business is the provider shell: a separate view, a separate
// sign-in, and none of the pet-parent navigation. Both hosts already rewrite
// every path to index.html (vercel.json, netlify.toml), so this needs no host
// config. Lazily loaded so a pet parent never downloads any of it.
const isProviderRoute = path === '/business' || path.startsWith('/business/')

// Two pages Google Play requires at a public URL: a privacy policy, and
// instructions for deleting an account. Both must open without installing the
// app and without signing in, so they cannot live behind the sign-in screen or
// inside a modal — which is where the privacy notice lived until now.
//
// They render the SAME PrivacyNotice component the app shows, with asPage set,
// rather than a second static copy. Two copies of a privacy notice drift, and
// one that describes an older version of the app is worse than none.
const isPrivacyRoute = path === '/privacy'
const isDeleteAccountRoute = path === '/delete-account'

import PrivacyNotice from './components/PrivacyNotice.jsx'
import DeleteAccountInfo from './components/DeleteAccountInfo.jsx'

const ProviderApp = lazy(() => import('./components/provider/ProviderApp.jsx'))

function Booting() {
  return <div style={{ minHeight: '100vh', backgroundColor: '#FFFEF8' }} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isProviderRoute
      ? <Suspense fallback={<Booting />}><ProviderApp /></Suspense>
      : isPrivacyRoute ? <PrivacyNotice asPage />
      : isDeleteAccountRoute ? <DeleteAccountInfo />
      : isRegisterRoute ? <ProviderRegistration /> : <App />}
  </React.StrictMode>,
)
