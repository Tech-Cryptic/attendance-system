import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// -- Icons ------------------------------------------------------

function FaceIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
      <circle cx="12" cy="13" r="3"/>
      <path d="M9.5 10.5c0-1.38 1.12-2.5 2.5-2.5"/>
    </svg>
  )
}

function EyeOpenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

function EyeClosedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}

// -- Component --------------------------------------------------

export default function LoginPage() {
  const { login } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const from = location.state?.from?.pathname ?? null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) { setError('Please fill in all fields.'); return }
    setError('')
    setLoading(true)
    try {
      const role = await login(email, password)
      const dest = from ?? ({ admin: '/admin', lecturer: '/lecturer', student: '/student' }[role] ?? '/')
      navigate(dest, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card fade-in-up">

        {/* Logo */}
        <div className="auth-logo">
          <FaceIcon />
        </div>

        {/* Heading */}
        <div className="auth-heading">
          <h1>Sign in to FaceAttend</h1>
          <p className="text-secondary">Unilorin biometric attendance, University of Ilorin</p>
        </div>

        <div className="stack">
        {/* Error */}
        {error && <div className="alert alert-danger">{error}</div>}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">

          {/* Email */}
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="you@unilorin.edu.ng"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          {/* Password + eye toggle */}
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                id="btn-toggle-password"
                type="button"
                className="password-toggle"
                onClick={() => setShowPass(v => !v)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
              >
                {showPass ? <EyeClosedIcon /> : <EyeOpenIcon />}
              </button>
            </div>
          </div>

          <button
            id="btn-login"
            type="submit"
          className="btn btn-primary btn-full"
          disabled={loading}
        >
          {loading ? (
            <><div className="spinner" /> Signing in...</>
          ) : (
            'Sign in'
          )}
        </button>
        </form>
        </div>

        {/* Student enrollment note */}
        <div className="auth-note">
          <div className="divider-label">New student?</div>
          <p className="text-center text-muted">
            Use the enrollment link sent to you by your lecturer to register your face biometric.
          </p>
        </div>

      </div>
    </div>
  )
}
