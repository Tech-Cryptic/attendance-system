import { useEffect, useState } from 'react'
import { API_BASE } from '../lib/api'
import { toast } from './Toast'

const STATUSES = ['present', 'left_early', 'absent', 'exempted', 'pending_review']

const STATUS_LABELS = {
  present: 'Present',
  left_early: 'Left early',
  absent: 'Absent',
  exempted: 'Exempted',
  pending_review: 'Pending review',
}

const DECISION_LABELS = {
  approve: 'Approved',
  override: 'Overridden',
  reject: 'Rejected',
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('fa_token')}`,
  }
}

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
      toast.success(data.fallback_used ? 'Guideline-based review ready (LLM unavailable).' : 'AI review ready.')
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
      toast.error('Copy failed. Select the text manually.')
    }
  }

  const pending = outcomes.filter((o) => o.status === 'pending_review')

  return (
    <div className="panel panel-body stack">
      <div className="stack-sm">
        <h4 className="panel-title">AI-assisted presence review</h4>
        <p className="text-sm text-secondary">
          The LLM suggests an outcome and drafts a message. Nothing changes until you approve,
          override, or reject the suggestion.
        </p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {pending.length === 0 && reviews.length === 0 && (
        <div className="empty-state">
          <p>No outcomes are waiting for review.</p>
        </div>
      )}

      <div className="stack">
        {pending.map((outcome) => {
          const review = reviews.find((r) => r.matric_number === outcome.matric_number)
          const isBusy = Boolean(busy[outcome.matric_number])
          const fieldKey = review?.id ?? outcome.matric_number.replace(/[^a-zA-Z0-9_-]/g, '-')
          const noteId = `review-note-${fieldKey}`
          const overrideId = `review-override-${fieldKey}`

          return (
            <div className="panel panel-body stack-sm" key={outcome.matric_number}>
              <div className="section-heading">
                <div className="stack-sm">
                  <div className="font-semibold">{outcome.full_name ?? outcome.matric_number}</div>
                  <div className="font-mono text-xs text-muted">{outcome.matric_number}</div>
                </div>
                <span className="badge badge-warning">Pending review</span>
              </div>

              {!review && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => generate(outcome.matric_number)}
                  disabled={isBusy}
                >
                  {isBusy ? 'Reviewing...' : 'Generate AI review'}
                </button>
              )}

              {review && (
                <div className="stack-sm">
                  <div className="inline-meta">
                    <span className="badge badge-info">
                      Suggested outcome: {STATUS_LABELS[review.recommended_status] ?? 'Review'}
                    </span>
                    <span>Confidence {Math.round((review.confidence ?? 0) * 100)}%</span>
                    {review.fallback_used && (
                      <span className="badge badge-warning">Guideline-based review</span>
                    )}
                    {review.decision_action && (
                      <span className="badge badge-success">
                        Decision: {DECISION_LABELS[review.decision_action] ?? 'Recorded'}
                      </span>
                    )}
                  </div>

                  <p className="text-sm">{review.reason_summary}</p>

                  {review.entities?.issues?.length > 0 && (
                    <div className="inline-meta">
                      <span>Flags: {review.entities.issues.join(', ')}</span>
                      {review.entities.route_to && <span>Route: {review.entities.route_to}</span>}
                    </div>
                  )}

                  <div className="alert alert-info stack-sm">
                    <div className="font-semibold">Draft message to student</div>
                    <div>{review.draft_message}</div>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => copyMessage(review.draft_message)}
                    >
                      Copy draft
                    </button>
                  </div>

                  {!review.decision_action && (
                    <div className="stack-sm">
                      <div className="field-grid">
                        <div className="form-group">
                          <label className="form-label" htmlFor={noteId}>Review note</label>
                          <input
                            id={noteId}
                            className="form-input"
                            value={notes[review.matric_number] ?? ''}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [review.matric_number]: e.target.value }))}
                            placeholder="Optional review note"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor={overrideId}>Final status</label>
                          <select
                            id={overrideId}
                            className="form-select"
                            value={overrides[review.matric_number] ?? 'present'}
                            onChange={(e) => setOverrides((prev) => ({ ...prev, [review.matric_number]: e.target.value }))}
                          >
                            {STATUSES.filter((s) => s !== 'pending_review').map((status) => (
                              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="form-actions">
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
                    </div>
                  )}

                  {review.decision_action && (
                    <p className="text-xs text-muted">
                      Final decision: {STATUS_LABELS[review.final_status] ?? 'Unchanged'}
                      {review.decision_note ? `. Note: ${review.decision_note}` : ''}
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
