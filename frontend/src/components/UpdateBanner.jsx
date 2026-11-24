import { useState, useEffect } from 'react'

export default function UpdateBanner() {
  const [visible, setVisible] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [swReg, setSwReg] = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined

    navigator.serviceWorker.ready.then(reg => {
      setSwReg(reg)
      if (reg.waiting) {
        setVisible(true)
        return
      }

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

    const onControllerChange = () => {
      if (updating) window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [updating])

  function handleUpdate() {
    if (!swReg?.waiting) return
    setUpdating(true)
    swReg.waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  if (!visible) return null

  return (
    <div className="update-banner" role="status">
      <span>A new version of FaceAttend is available.</span>
      <div className="pwa-banner-actions">
        <button id="btn-sw-update" type="button" className="btn btn-primary btn-sm" onClick={handleUpdate} disabled={updating}>
          {updating ? 'Updating…' : 'Refresh now'}
        </button>
        <button type="button" className="modal-close-btn" aria-label="Dismiss update notice" onClick={() => setVisible(false)}>
          ×
        </button>
      </div>
    </div>
  )
}
