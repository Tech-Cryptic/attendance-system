import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

let _addToast = null

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

const TONES = {
  success: { label: 'Success', className: 'badge badge-success' },
  error: { label: 'Error', className: 'badge badge-danger' },
  info: { label: 'Info', className: 'badge badge-info' },
  warning: { label: 'Warning', className: 'badge badge-warning' },
}

export const toast = {
  success: (msg, opts) => _addToast?.({ msg, type: 'success', ...opts }),
  error:   (msg, opts) => _addToast?.({ msg, type: 'error',   ...opts }),
  info:    (msg, opts) => _addToast?.({ msg, type: 'info',    ...opts }),
  warning: (msg, opts) => _addToast?.({ msg, type: 'warning', ...opts }),
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const removeToast = useCallback(id => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback(({ msg, type = 'info', duration = 4000 }) => {
    const id = ++counter.current
    setToasts(prev => [...prev.slice(-4), { id, msg, type }])
    setTimeout(() => removeToast(id), duration)
  }, [removeToast])

  useEffect(() => {
    _addToast = addToast
    return () => { _addToast = null }
  }, [addToast])

  if (!toasts.length) return null

  return createPortal(
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(t => {
        const tone = TONES[t.type] ?? TONES.info
        return (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className={tone.className}>{tone.label}</span>
            <span className="toast-message">{t.msg}</span>
            <button
              type="button"
              className="modal-close-btn"
              aria-label="Dismiss notification"
              onClick={() => removeToast(t.id)}
            >
              <CloseIcon />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
