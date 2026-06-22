/**
 * UpdateBanner — PWA "New version available" notification
 *
 * The service worker posts a message when a new version is waiting.
 * This banner shows a "Refresh to update" prompt and applies the
 * waiting SW immediately when confirmed.
 */
import { useState, useEffect } from 'react'

export default function UpdateBanner() {
  const [visible, setVisible]     = useState(false)
  const [updating, setUpdating]   = useState(false)
  const [swReg, setSwReg]         = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.ready.then(reg => {
      setSwReg(reg)

      // New SW waiting immediately on load
      if (reg.waiting) {
        setVisible(true)
        return
      }

      // New SW found during session
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setVisible(true)
          }
        })
      })
    })

    // Listen for controllerchange (after skipWaiting)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updating) window.location.reload()
    })
  }, [updating])

  function handleUpdate() {
    if (!swReg?.waiting) return
    setUpdating(true)
    swReg.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      zIndex: 9000,
      background: 'linear-gradient(135deg, rgba(79,70,229,0.95), rgba(124,58,237,0.95))',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid rgba(255,255,255,0.12)',
      padding: '12px 20px',
      display: 'flex', alignItems: 'center', gap: '12px',
      boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
      animation: 'slideDown 0.4s ease',
    }}>
      <span style={{ fontSize: '18px' }}>🔄</span>
      <span style={{ flex: 1, fontSize: '13px', color: '#fff', fontWeight: 500 }}>
        A new version of FaceAttend is available.
      </span>
      <button
        id="btn-sw-update"
        onClick={handleUpdate}
        disabled={updating}
        style={{
          padding: '7px 16px', borderRadius: '8px',
          background: 'rgba(255,255,255,0.2)',
          border: '1px solid rgba(255,255,255,0.3)',
          color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          backdropFilter: 'blur(4px)',
        }}
      >
        {updating ? 'Updating…' : 'Refresh now'}
      </button>
      <button
        onClick={() => setVisible(false)}
        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '4px' }}
      >
        ×
      </button>
    </div>
  )
}
