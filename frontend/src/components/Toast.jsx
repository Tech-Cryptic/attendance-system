/**
 * Toast Notification System
 *
 * Usage:
 *   import { toast, ToastContainer } from './Toast'
 *   toast.success('Attendance marked!')
 *   toast.error('Face not recognised')
 *   toast.info('Syncing 3 records…')
 *   toast.warning('You are offline')
 *
 * Mount <ToastContainer /> once at the app root.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

let _addToast = null   // injected by ToastContainer

export const toast = {
  success: (msg, opts) => _addToast?.({ msg, type: 'success', ...opts }),
  error:   (msg, opts) => _addToast?.({ msg, type: 'error',   ...opts }),
  info:    (msg, opts) => _addToast?.({ msg, type: 'info',    ...opts }),
  warning: (msg, opts) => _addToast?.({ msg, type: 'warning', ...opts }),
}

const ICONS = { success: '✓', error: '!', info: 'i', warning: '!' }

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
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span style={{ flexShrink: 0, fontWeight: 700 }}>{ICONS[t.type]}</span>
          <span style={{ color: 'var(--text-primary)', flex: 1 }}>{t.msg}</span>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Dismiss notification"
            onClick={() => removeToast(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
