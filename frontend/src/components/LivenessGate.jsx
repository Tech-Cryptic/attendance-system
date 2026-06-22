/**
 * LivenessGate — Visual EAR Blink Challenge Component
 *
 * Displays a prominent blink instruction overlay on top of FaceCamera.
 * Shows animated progress ring, blink counter, timer countdown.
 * Auto-advances when LivenessMonitor.passed === true.
 */
export default function LivenessGate({ status, rppgScore }) {
  if (!status) {
    return (
      <div style={overlayStyle}>
        <div className="liveness-ring">
          <span style={{ fontSize: '28px' }}>👁</span>
        </div>
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
        <div className="liveness-ring pass" style={{ borderColor: 'var(--success)', boxShadow: '0 0 0 4px rgba(16,185,129,0.2), 0 0 30px rgba(16,185,129,0.4)' }}>
          <span style={{ fontSize: '32px' }}>✅</span>
        </div>
        <p style={{ color: 'var(--success)', fontWeight: 700, fontSize: '16px' }}>Liveness confirmed!</p>
        {rppgScore !== null && (
          <div className="badge badge-success" style={{ marginTop: '4px' }}>
            💓 Pulse detected ({rppgScore != null ? `${Math.round(rppgScore * 100)}%` : '—'})
          </div>
        )}
      </div>
    )
  }

  if (failed) {
    return (
      <div style={overlayStyle}>
        <div className="liveness-ring" style={{ borderColor: 'var(--danger)', boxShadow: '0 0 0 4px rgba(239,68,68,0.2)' }}>
          <span style={{ fontSize: '32px' }}>⏰</span>
        </div>
        <p style={{ color: 'var(--danger)', fontWeight: 700 }}>Timed out</p>
        <p className="text-secondary text-sm" style={{ textAlign: 'center' }}>
          Please look at the camera and blink naturally
        </p>
      </div>
    )
  }

  // In-progress
  return (
    <div style={overlayStyle}>
      {/* Animated ring with progress */}
      <div style={{ position: 'relative', marginBottom: '16px' }}>
        <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
          {/* Background track */}
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          {/* Progress arc */}
          <circle
            cx="60" cy="60" r="52" fill="none"
            stroke="url(#progressGrad)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 52}`}
            strokeDashoffset={`${2 * Math.PI * 52 * (1 - progress)}`}
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
          />
          <defs>
            <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
        </svg>
        {/* Center content */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }}>
          <span style={{ fontSize: '24px', lineHeight: 1 }}>👁</span>
          <span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {blinkCount}/{required}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            blinks
          </span>
        </div>
      </div>

      {/* Instruction */}
      <p style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '15px', textAlign: 'center', margin: '0 0 8px' }}>
        Please blink naturally
      </p>
      <p className="text-secondary text-sm" style={{ textAlign: 'center', margin: '0 0 12px' }}>
        Look directly at the camera and blink slowly
      </p>

      {/* Blink dots */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        {Array.from({ length: required }).map((_, i) => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: '50%',
            background: i < blinkCount ? 'var(--success)' : 'rgba(255,255,255,0.12)',
            border: `2px solid ${i < blinkCount ? 'var(--success)' : 'rgba(255,255,255,0.2)'}`,
            boxShadow: i < blinkCount ? '0 0 8px var(--success)' : 'none',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>

      {/* Timer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '12px', color: secondsLeft < 5 ? 'var(--danger)' : 'var(--text-muted)',
        transition: 'color 0.3s',
      }}>
        <span>⏱</span>
        <span>{secondsLeft}s remaining</span>
      </div>

      {/* rPPG passive indicator */}
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
  padding: '24px',
  gap: '8px',
}
