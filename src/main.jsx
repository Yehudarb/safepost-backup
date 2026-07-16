import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css' // CRITICAL: This imports the Tailwind styles
import { AuthProvider } from '@/context/AuthContext'
import AuthGate from '@/components/auth/AuthGate'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <AuthProvider>
            <AuthGate>
                <App />
            </AuthGate>
        </AuthProvider>
    </React.StrictMode>,
)
