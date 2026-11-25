import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const HOME_ROUTES = { admin: '/admin', lecturer: '/lecturer', student: '/student' }

export default function NotFound() {
  const { user } = useAuth()
  const homePath = HOME_ROUTES[user?.role] ?? '/login'
  const homeLabel = user?.role ? 'Return to dashboard' : 'Go to sign in'

  return (
    <div className="focus-page">
      <div className="focus-card fade-in-up stack">
        <div>
          <p className="eyebrow">404</p>
          <h2 className="focus-title">Page not available</h2>
        </div>
        <p className="lead">The page you requested does not exist or is outside your access.</p>
        <div className="form-actions">
          <Link to={homePath} className="btn btn-primary">{homeLabel}</Link>
        </div>
      </div>
    </div>
  )
}
