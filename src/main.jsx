import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ProviderRegistration from './components/ProviderRegistration.jsx'
import './index.css'
import { installErrorReporting } from './lib/errorReport.js'

// Before render, so a fault during the first paint is still reported.
installErrorReporting()

const isRegisterRoute = window.location.pathname.replace(/\/+$/, '') === '/register-provider'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isRegisterRoute ? <ProviderRegistration /> : <App />}
  </React.StrictMode>,
)
