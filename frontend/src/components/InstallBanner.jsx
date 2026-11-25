import { useState, useEffect } from 'react'

const DISMISS_KEY = 'faceattend_pwa_dismissed'
const DISMISS_DAYS = 7

function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem(DISMISS_KEY)
    if (dismissed && Date.now() - Number(dismissed) < DISMISS_DAYS * 86400000) return
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const handler = event => {
      event.preventDefault()
      setDeferredPrompt(event)
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
    <div className="pwa-banner" role="status">
      <div className="pwa-banner-icon">
        <DownloadIcon />
      </div>
      <div className="pwa-banner-copy">
        <strong>Install FaceAttend</strong>
        <span>Add to your home screen for offline access</span>
      </div>
      <div className="pwa-banner-actions">
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss install prompt" onClick={handleDismiss}>Not now</button>
        <button id="btn-pwa-install" type="button" className="btn btn-primary btn-sm" onClick={handleInstall} disabled={installing}>
          {installing ? 'Installing...' : 'Install'}
        </button>
      </div>
    </div>
  )
}
