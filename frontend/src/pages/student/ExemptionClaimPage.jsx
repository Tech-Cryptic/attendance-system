import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../lib/api'

/**
 * ExemptionClaimPage — any-device claim flow.
 *
 * Teaching note:
 * The URL token is a capability, but the JWT is the identity. ProtectedRoute
 * sends an unauthenticated student to /login with this path as `from`, so after
 * login the student returns here and the claim is bound to their own matric.
 * No biometric model, local database, or original device is required.
 */
export default function ExemptionClaimPage() {
  const { token } = useParams()
  const { authFetch } = useAuth()

  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    async function loadPreview() {
      try {
        const res = await fetch(`${API_BASE}/presence/exemptions/${token}/preview`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail ?? 'Link could not be verified.')
        setPreview(data)
        setStatus(data.status === 'active' ? 'ready' : data.status)
      } catch (err) {
        setStatus('error')
        setMessage(err.message)
      }
    }
    loadPreview()
  }, [token])

  async function handleClaim() {
    setClaiming(true)
    setMessage('')
    try {
      const res = await authFetch(`/presence/exemptions/${token}/claim`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Claim failed.')
      setStatus('claimed')
      setMessage(data.message)
    } catch (err) {
      setMessage(err.message)
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-in-up">
        <h1 style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--sp-2)' }}>Attendance exemption</h1>

        {status === 'loading' && <p className="text-secondary">Checking your link…</p>}

        {status === 'error' && <div className="alert alert-danger">{message}</div>}

        {status !== 'loading' && status !== 'error' && preview && (
          <>
            <p className="text-secondary" style={{ marginBottom: 'var(--sp-4)' }}>
              Course <strong>{preview.course_code}</strong>
            </p>

            {status === 'ready' && (
              <button className="btn btn-primary" onClick={handleClaim} disabled={claiming}>
                {claiming ? 'Claiming…' : 'Confirm attendance exemption'}
              </button>
            )}

            {status === 'claimed' && (
              <div className="alert alert-success">{message}</div>
            )}

            {['used', 'expired', 'revoked'].includes(status) && (
              <div className="alert alert-warning">
                This link is {status}. Contact your lecturer if you need a new one.
              </div>
            )}

            {message && status !== 'claimed' && <p className="form-error">{message}</p>}
          </>
        )}
      </div>
    </div>
  )
}
