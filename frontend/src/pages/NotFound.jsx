import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="focus-page">
      <div className="focus-card fade-in-up text-center">
        <div style={{ fontSize: '56px', marginBottom: 'var(--sp-2)', fontWeight: 700, color: 'var(--accent)', letterSpacing: '-0.06em' }}>
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
