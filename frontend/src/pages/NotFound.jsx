import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="auth-page">
      <div className="auth-card fade-in-up text-center">
        <div style={{ fontSize: '64px', marginBottom: '8px', fontWeight: 800, background: 'var(--brand-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          404
        </div>
        <h2>Page Not Found</h2>
        <p className="text-secondary" style={{ margin: '12px 0 24px' }}>
          The page you're looking for doesn't exist or you don't have permission to view it.
        </p>
        <Link to="/" className="btn btn-primary">
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
