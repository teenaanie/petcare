import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ProviderRegistration from './components/ProviderRegistration.jsx'
import './index.css'

const isRegisterRoute = window.location.pathname.replace(/\/+$/, '') === '/register-provider'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isRegisterRoute ? <ProviderRegistration /> : <App />}
  </React.StrictMode>,
)
