import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/api'
import { toast } from './Toast'

const STATUSES = ['present', 'left_early', 'absent', 'exempted', 'pending_review']

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('fa_token')}`,
  }
}

/**
 * PresenceReviewPanel — LLM suggestion with a human decision gate.
 *
 * The model never writes attendance_outcomes. It only produces a validated
 * suggestion and a draft message. Approve/Override/Reject is the human step.
 */
export default function PresenceReviewPanel({ session, outcomes, onDecision }) {
  const [reviews, setReviews] = useState([])
  const [busy, setBusy] = useState({})
  const [notes, setNotes] = useState({})
  const [overrides, setOverrides] = useState({})
  const [error, setError] = useState('')

  async function loadReviews() {
    try {
      const res = await fetch(`${API_BASE}/presence/reviews?session_id=${session.session_id}`, {
        headers: authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Could not load reviews.')
      setReviews(data)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!session?.session_id) return undefined
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/presence/reviews?session_id=${session.session_id}`, {
          headers: authHeaders(),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail ?? 'Could not load reviews.')
        if (!cancelled) setReviews(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }

    load()
    return () => { cancelled = true }
  }, [session?.session_id])

  async function generate(matricNumber) {
    setBusy((prev) => ({ ...prev, [matricNumber]: 'generate' }))
    setError('')
    try {
      const res = await fetch(`${API_BASE}/presence/reviews/generate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ session_id: session.session_id, matric_number: matricNumber }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Could not generate review.')
      await loadReviews()
      toast.success(data.fallback_used ? 'Rule-based review ready (LLM unavailable).' : 'AI review ready.')
    } catch (err) {
      setError(err.message)
      toast.error(err.message)
    } finally {
      setBusy((prev) => ({ ...prev, [matricNumber]: null }))
    }
  }

  async function decide(review, action) {
    setBusy((prev) => ({ ...prev, [review.matric_number]: action }))
    setError('')
    try {
      const res = await fetch(`${API_BASE}/presence/reviews/${review.id}/decision`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action,
          final_status: action === 'override' ? overrides[review.matric_number] : undefined,
          note: notes[review.matric_number] ?? '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Could not record decision.')
      await loadReviews()
      if (onDecision) await onDecision()
      toast.success(action === 'reject' ? 'Suggestion rejected.' : 'Outcome updated.')
    } catch (err) {
      setError(err.message)
      toast.error(err.message)
    } finally {
      setBusy((prev) => ({ ...prev, [review.matric_number]: null }))
    }
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message)
      toast.success('Draft message copied.')
    } catch {
      toast.error('Copy failed — select the text manually.')
    }
  }

  const pending = outcomes.filter((o) => o.status === 'pending_review')

  return (
    <div className="card">
      <h4 style={{ margin: '0 0 var(--sp-2)' }}>AI-assisted presence review</h4>
      <p className="text-sm text-secondary" style={{ margin: '0 0 var(--sp-4)' }}>
        The LLM suggests an outcome and drafts a message. Nothing changes until you approve,
        override, or reject the suggestion.
      </p>

      {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--sp-3)' }}>{error}</div>}

      {pending.length === 0 && reviews.length === 0 && (
        <p className="text-sm text-muted">No outcomes are waiting for review.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {pending.map((outcome) => {
          const review = reviews.find((r) => r.matric_number === outcome.matric_number)
          const isBusy = Boolean(busy[outcome.matric_number])

          return (
            <div
              key={outcome.matric_number}
              style={{
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--sp-4)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{outcome.full_name ?? outcome.matric_number}</div>
                  <div className="font-mono text-xs text-muted">{outcome.matric_number}</div>
                </div>
                <span className="badge badge-warning">pending_review</span>
              </div>

              {!review && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => generate(outcome.matric_number)}
                  disabled={isBusy}
                  style={{ marginTop: 'var(--sp-3)' }}
                >
                  {isBusy ? 'Reviewing…' : 'Generate AI review'}
                </button>
              )}

              {review && (
                <div style={{ marginTop: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="badge badge-info">suggested: {review.recommended_status}</span>
                    <span className="text-xs text-muted">
                      confidence {Math.round((review.confidence ?? 0) * 100)}%
                    </span>
                    {review.fallback_used && <span className="badge badge-warning">rule-based fallback</span>}
                    {review.decision_action && (
                      <span className="badge badge-success">decided: {review.decision_action}</span>
                    )}
                  </div>

                  <p className="text-sm" style={{ margin: 'var(--sp-3) 0' }}>{review.reason_summary}</p>

                  {review.entities?.issues?.length > 0 && (
                    <div className="text-xs text-muted" style={{ marginBottom: 'var(--sp-3)' }}>
                      Flags: {review.entities.issues.join(' · ')}
                      {review.entities.route_to ? ` · route: ${review.entities.route_to}` : ''}
                    </div>
                  )}

                  <div className="alert alert-info text-sm" style={{ marginBottom: 'var(--sp-3)' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Draft message to student</div>
                    <div>{review.draft_message}</div>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => copyMessage(review.draft_message)}
                      style={{ marginTop: '8px' }}
                    >
                      Copy draft
                    </button>
                  </div>

                  {!review.decision_action && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <input
                        className="form-input"
                        value={notes[review.matric_number] ?? ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [review.matric_number]: e.target.value }))}
                        placeholder="Optional review note"
                        style={{ maxWidth: '260px' }}
                      />
                      <select
                        className="form-select"
                        value={overrides[review.matric_number] ?? 'present'}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [review.matric_number]: e.target.value }))}
                        style={{ maxWidth: '170px' }}
                      >
                        {STATUSES.filter((s) => s !== 'pending_review').map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => decide(review, 'approve')}
                        disabled={isBusy}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => decide(review, 'override')}
                        disabled={isBusy}
                      >
                        Override
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        type="button"
                        onClick={() => decide(review, 'reject')}
                        disabled={isBusy}
                      >
                        Reject
                      </button>
                    </div>
                  )}

                  {review.decision_action && (
                    <p className="text-xs text-muted" style={{ margin: 'var(--sp-3) 0 0' }}>
                      Final decision: {review.final_status ?? 'unchanged'}
                      {review.decision_note ? ` — ${review.decision_note}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
