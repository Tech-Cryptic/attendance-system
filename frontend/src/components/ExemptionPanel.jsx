import { useState } from 'react'
import { API_BASE } from '../lib/api'
import { toast } from './Toast'

/** Lecturer-side manual exemption panel. */
export default function ExemptionPanel({ session }) {
  const [matric, setMatric] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [claimUrl, setClaimUrl] = useState(null)
  const [error, setError] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setClaimUrl(null)

    if (!matric.trim() || reason.trim().length < 3) {
      setError('Enter the student matric number and a short reason.')
      return
    }

    setLoading(true)
    try {
      const token = localStorage.getItem('fa_token')
      const res = await fetch(`${API_BASE}/presence/exemptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: session.session_id,
          matric_number: matric.trim(),
          reason: reason.trim(),
          expires_in_hours: 24,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Could not create exemption.')
      setClaimUrl(data.claim_url)
      toast.success('One-time exemption link created.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(claimUrl)
      toast.success('Link copied.')
    } catch {
      toast.error('Copy failed — select the link manually.')
    }
  }

  return (
    <div className="card">
      <h4 style={{ margin: '0 0 var(--sp-2)' }}>Manual attendance exemption</h4>
      <p className="text-sm text-secondary" style={{ margin: '0 0 var(--sp-4)' }}>
        Use this when a student's phone or laptop was unavailable. The student opens the
        generated link on any device after signing in.
      </p>

      {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--sp-3)' }}>{error}</div>}

      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="form-group">
          <label className="form-label" htmlFor="exemption-matric">Student matric number</label>
          <input
            id="exemption-matric"
            className="form-input"
            value={matric}
            onChange={(e) => setMatric(e.target.value)}
            placeholder="e.g. 22/01DL068"
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="exemption-reason">Reason</label>
          <input
            id="exemption-reason"
            className="form-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Phone battery died during lecture"
          />
        </div>
        <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Generate one-time link'}
        </button>
      </form>

      {claimUrl && (
        <div className="alert alert-success" style={{ marginTop: 'var(--sp-4)', wordBreak: 'break-all' }}>
          <div style={{ marginBottom: '8px' }}>Send this link to the student:</div>
          <code>{claimUrl}</code>
          <button className="btn btn-ghost btn-sm" type="button" onClick={copyLink} style={{ marginTop: '8px' }}>
            Copy link
          </button>
        </div>
      )}
    </div>
  )
}
