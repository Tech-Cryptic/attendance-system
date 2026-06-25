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

const ICONS  = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' }
const COLORS = {
  success: { bg: 'var(--success-bg)', border: 'var(--success)', text: 'var(--success)' },
  error:   { bg: 'var(--danger-bg)',  border: 'var(--danger)',  text: 'var(--danger)'  },
  info:    { bg: 'var(--accent-muted)', border: 'var(--accent)', text: 'var(--accent)'  },
  warning: { bg: 'var(--warning-bg)', border: 'var(--warning)', text: 'var(--warning)' },
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const addToast = useCallback(({ msg, type = 'info', duration = 4000 }) => {
    const id = ++counter.current
    setToasts(prev => [...prev.slice(-4), { id, msg, type }])   // max 5 at once
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  useEffect(() => {
    _addToast = addToast
    return () => { _addToast = null }
  }, [addToast])

  if (!toasts.length) return null

  return createPortal(
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: '10px',
      pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const c = COLORS[t.type] ?? COLORS.info
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: '12px',
            padding: '12px 16px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            maxWidth: 340, minWidth: 220,
            pointerEvents: 'auto',
            animation: 'fadeInUp 0.3s ease',
            fontSize: '13px', lineHeight: 1.5,
          }}>
            <span style={{ flexShrink: 0, fontSize: '16px' }}>{ICONS[t.type]}</span>
            <span style={{ color: 'var(--text-primary)', flex: 1 }}>{t.msg}</span>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
