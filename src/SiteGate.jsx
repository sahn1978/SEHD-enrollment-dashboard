import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { SITE_PASSWORD_HASH } from './config.js'

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const SITE_PROTECTION_ENABLED = !!SITE_PASSWORD_HASH && SITE_PASSWORD_HASH.length === 64

export default function SiteGate({ children }) {
  const [unlocked, setUnlocked] = useState(!SITE_PROTECTION_ENABLED)
  const [checking, setChecking] = useState(SITE_PROTECTION_ENABLED)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!SITE_PROTECTION_ENABLED) return
    try {
      if (localStorage.getItem('edash:site') === '1') {
        setUnlocked(true)
      }
    } catch {}
    setChecking(false)
  }, [])

  const tryLogin = async (e) => {
    e.preventDefault()
    if (!password) return
    setSubmitting(true)
    setError('')
    try {
      const hash = await sha256Hex(password)
      if (hash === SITE_PASSWORD_HASH.toLowerCase()) {
        try { localStorage.setItem('edash:site', '1') } catch {}
        setUnlocked(true)
        setPassword('')
      } else {
        setError('Incorrect password')
        await new Promise(r => setTimeout(r, 500))
      }
    } catch {
      setError('Could not verify password. Your browser may not support the Web Crypto API.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return null

  if (unlocked) {
    return children
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#F7F2E8', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div className="max-w-sm w-full">
        <div
          className="bg-white p-8"
          style={{ border: '1px solid #D4C9B0', boxShadow: '0 20px 40px rgba(30, 26, 18, 0.08)' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} strokeWidth={1.5} style={{ color: '#1E2A44' }} />
            <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-medium">
              Enrollment Intelligence
            </div>
          </div>
          <h1
            className="text-2xl text-stone-900 mb-5 leading-tight"
            style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, letterSpacing: '-0.01em' }}
          >
            FY27 Matriculation Tracker
          </h1>
          <p className="text-sm text-stone-600 mb-5 leading-relaxed">
            This dashboard is access controlled. Enter the password to continue.
          </p>
          <form onSubmit={tryLogin}>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              className="w-full px-3 py-2.5 mb-3 text-sm focus:outline-none"
              style={{
                background: '#FAF6EC',
                border: '1px solid ' + (error ? '#8B2635' : '#D4C9B0'),
                fontFamily: "'IBM Plex Sans', sans-serif",
              }}
              placeholder="Password"
              disabled={submitting}
            />
            {error && (
              <div className="text-xs mb-3" style={{ color: '#8B2635' }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={!password || submitting}
              className="w-full px-4 py-2.5 text-sm font-medium text-white transition-opacity"
              style={{ background: '#1E2A44', opacity: (!password || submitting) ? 0.5 : 1 }}
            >
              {submitting ? 'Checking...' : 'Enter Dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
