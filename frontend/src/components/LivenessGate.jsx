export default function LivenessGate({ status, rppgScore }) {
  if (!status) {
    return (
      <div style={overlayStyle}>
        <div className="liveness-ring" />
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center' }}>
          Position your face in the camera frame
        </p>
      </div>
    )
  }

  const { blinkCount, required, passed, failed, timeRemaining, progress } = status
  const secondsLeft = Math.ceil(timeRemaining / 1000)

  if (passed) {
    return (
      <div style={overlayStyle}>
        <div className="liveness-ring pass">
          <span style={{ fontSize: '28px' }}>✓</span>
        </div>
        <p style={{ color: 'var(--success)', fontWeight: 700, fontSize: '16px' }}>Liveness confirmed</p>
        {rppgScore !== null && (
          <div className="badge badge-success" style={{ marginTop: '4px' }}>
            Pulse detected ({rppgScore != null ? `${Math.round(rppgScore * 100)}%` : '—'})
          </div>
        )}
      </div>
    )
  }

  if (failed) {
    return (
      <div style={overlayStyle}>
        <div className="liveness-ring" style={{ borderColor: 'var(--danger)' }}>
          <span style={{ fontSize: '28px' }}>!</span>
        </div>
        <p style={{ color: 'var(--danger)', fontWeight: 700 }}>Timed out</p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
          Look at the camera and blink naturally
        </p>
      </div>
    )
  }

  return (
    <div style={overlayStyle}>
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <svg width="112" height="112" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="56" cy="56" r="48" fill="none" stroke="var(--border-default)" strokeWidth="4" />
          <circle
            cx="56" cy="56" r="48" fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 48}`}
            strokeDashoffset={`${2 * Math.PI * 48 * (1 - progress)}`}
            style={{ transition: 'stroke-dashoffset 0.2s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '2px',
        }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>BLINK</span>
          <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {blinkCount}/{required}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            blinks
          </span>
        </div>
      </div>

      <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '15px', textAlign: 'center', margin: '0 0 6px' }}>
        Please blink naturally
      </p>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', margin: '0 0 10px' }}>
        Look directly at the camera and blink slowly
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '12px', color: secondsLeft < 5 ? 'var(--danger)' : 'var(--text-muted)',
        transition: 'color 0.2s',
      }}>
        <span>{secondsLeft}s remaining</span>
      </div>

      {rppgScore !== null && (
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div className={`sync-dot ${rppgScore > 0.4 ? 'online' : 'syncing'}`} />
          rPPG: {rppgScore > 0 ? `${Math.round(rppgScore * 100)}%` : 'sampling…'}
        </div>
      )}
    </div>
  )
}

const overlayStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
  gap: '8px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-lg)',
}
