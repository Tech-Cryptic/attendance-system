function StatusOverlay({ instruction, children }) {
  return (
    <div className="panel panel-body stack items-center text-center relative">
      <span className="sr-only" aria-live="polite">{instruction}</span>
      {children}
    </div>
  )
}

export default function LivenessGate({ status, rppgScore }) {
  if (!status) {
    return (
      <StatusOverlay instruction="Position your face in the camera frame">
        <div className="liveness-ring" />
        <p className="text-sm text-secondary">Position your face in the camera frame</p>
      </StatusOverlay>
    )
  }

  const { blinkCount, required, passed, failed, timeRemaining, progress } = status
  const secondsLeft = Math.ceil(timeRemaining / 1000)

  if (passed) {
    return (
      <StatusOverlay instruction="Liveness confirmed">
        <div className="liveness-ring pass">
          <span className="badge badge-success">Passed</span>
        </div>
        <p className="font-semibold text-success">Liveness confirmed</p>
        {rppgScore !== null && (
          <span className="badge badge-success">
            Pulse detected ({rppgScore != null ? `${Math.round(rppgScore * 100)}%` : 'pending'})
          </span>
        )}
      </StatusOverlay>
    )
  }

  if (failed) {
    return (
      <StatusOverlay instruction="Liveness timed out. Please retry. Look at the camera and blink naturally">
        <div className="liveness-ring">
          <span className="badge badge-danger">Retry needed</span>
        </div>
        <p className="font-semibold text-danger">Liveness timed out. Please retry</p>
        <p className="text-sm text-secondary">Look at the camera and blink naturally</p>
      </StatusOverlay>
    )
  }

  const instruction = `Please blink naturally. ${blinkCount} of ${required} blinks detected. ${secondsLeft} seconds remaining.`

  return (
    <StatusOverlay instruction={instruction}>
      <div className="relative">
        <svg width="112" height="112" viewBox="0 0 112 112" style={{ transform: 'rotate(-90deg)' }}>
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
        <div className="face-camera-overlay stack-sm items-center" style={{ justifyContent: 'center' }}>
          <span className="eyebrow">BLINK</span>
          <span className="text-xl font-bold tabular">{blinkCount}/{required}</span>
          <span className="eyebrow">blinks</span>
        </div>
      </div>

      <p className="font-semibold">Please blink naturally</p>
      <p className="text-sm text-secondary">Look directly at the camera and blink slowly</p>

      <div className={`inline-meta${secondsLeft < 5 ? ' text-danger' : ''}`}>
        <span>{secondsLeft}s remaining</span>
      </div>

      {rppgScore !== null && (
        <div className="inline-meta">
          <span className={`sync-dot ${rppgScore > 0.4 ? 'online' : 'syncing'}`} />
          <span>Pulse signal: {rppgScore > 0 ? `${Math.round(rppgScore * 100)}%` : 'measuring'}</span>
        </div>
      )}
    </StatusOverlay>
  )
}
