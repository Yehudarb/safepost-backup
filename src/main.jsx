import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css' // CRITICAL: This imports the Tailwind styles
import { AuthProvider } from '@/context/AuthContext'
import AuthGate from '@/components/auth/AuthGate'
import DemoBanner from '@/components/auth/DemoBanner'
import { applyA11y, loadSettings } from '@/components/AccessibilityWidget/vee/useA11y'
import { LanguageProvider } from '@/lib/i18n'

// Apply any saved accessibility settings before the tree mounts, so returning
// users don't see a flash of unstyled content while React boots.
applyA11y(loadSettings())

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <LanguageProvider>
            <AuthProvider>
                <AuthGate>
                    <DemoBanner />
                    <App />
                </AuthGate>
            </AuthProvider>
        </LanguageProvider>
    </React.StrictMode>,
)
