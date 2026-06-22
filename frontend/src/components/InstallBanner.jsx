/**
 * InstallBanner — PWA "Add to Home Screen" prompt
 *
 * Listens for the `beforeinstallprompt` event (Chrome/Edge/Android).
 * Shows a dismissible banner at the bottom of the screen.
 * Once dismissed, remembers for 7 days in localStorage.
 */
import { useState, useEffect } from 'react'

const DISMISS_KEY   = 'faceattend_pwa_dismissed'
const DISMISS_DAYS  = 7

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible]               = useState(false)
  const [installing, setInstalling]         = useState(false)

  useEffect(() => {
    // Don't show if dismissed recently
    const dismissed = localStorage.getItem(DISMISS_KEY)
    if (dismissed && Date.now() - Number(dismissed) < DISMISS_DAYS * 86400000) return

    // Don't show if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    setInstalling(true)
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setVisible(false)
    } else {
      setInstalling(false)
    }
    setDeferredPrompt(null)
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      zIndex: 8888,
      background: 'rgba(14,14,28,0.96)',
      borderTop: '1px solid rgba(124,58,237,0.4)',
      backdropFilter: 'blur(16px)',
      padding: '16px 20px',
      display: 'flex', alignItems: 'center', gap: '14px',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
      animation: 'slideUp 0.4s ease',
    }}>
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: '12px', flexShrink: 0,
        background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
        display: 'grid', placeItems: 'center', fontSize: '22px',
        boxShadow: '0 0 16px rgba(124,58,237,0.4)',
      }}>
        📲
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
          Install FaceAttend
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
          Add to your home screen for fast, offline access
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={handleDismiss}
          style={{
            padding: '8px 14px', borderRadius: '8px',
            background: 'transparent', border: '1px solid var(--border-default)',
            color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer',
          }}
        >
          Not now
        </button>
        <button
          id="btn-pwa-install"
          onClick={handleInstall}
          disabled={installing}
          style={{
            padding: '8px 18px', borderRadius: '8px',
            background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
            border: 'none', color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 0 12px rgba(124,58,237,0.4)',
          }}
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      </div>
    </div>
  )
}
