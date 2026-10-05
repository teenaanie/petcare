import React from 'react'
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

const isRegisterRoute = window.location.pathname.replace(/\/+$/, '') === '/register-provider'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isRegisterRoute ? <ProviderRegistration /> : <App />}
  </React.StrictMode>,
)
