import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { lazy, Suspense } from 'react'
import { ToastContainer } from './components/Toast'
import InstallBanner from './components/InstallBanner'
import UpdateBanner  from './components/UpdateBanner'
import './index.css'

// ── Lazy-loaded pages (code-split for performance) ─────────────
const LoginPage         = lazy(() => import('./pages/auth/LoginPage'))
const AdminDashboard    = lazy(() => import('./pages/admin/AdminDashboard'))
const LecturerDashboard = lazy(() => import('./pages/lecturer/LecturerDashboard'))
const SessionPage       = lazy(() => import('./pages/lecturer/SessionPage'))
const BatchScanPage     = lazy(() => import('./pages/lecturer/BatchScanPage'))
const StudentDashboard  = lazy(() => import('./pages/student/StudentDashboard'))
const EnrollPage        = lazy(() => import('./pages/student/EnrollPage'))
const AttendancePage    = lazy(() => import('./pages/student/AttendancePage'))
const NotFound          = lazy(() => import('./pages/NotFound'))

// ── Page-level loading fallback ────────────────────────────────
function PageSpinner() {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex',
      flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: '16px',
      background: 'var(--bg-base)',
    }}>
      {/* Animated brand logo */}
      <div style={{
        width: 56, height: 56, borderRadius: '16px',
        background: 'linear-gradient(135deg,#4f46e5,#7c3aed,#06b6d4)',
        display: 'grid', placeItems: 'center', fontSize: '24px',
        boxShadow: '0 0 30px rgba(124,58,237,0.4)',
        animation: 'pulse 1.5s ease infinite',
      }}>
        😊
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div className="spinner" />
        <span className="text-secondary text-sm">Loading FaceAttend…</span>
      </div>
    </div>
  )
}

// ── Protected Route wrapper ─────────────────────────────────────
function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <PageSpinner />
  if (!user)   return <Navigate to="/login" state={{ from: location }} replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const roleHome = { admin: '/admin', lecturer: '/lecturer', student: '/student' }
    return <Navigate to={roleHome[user.role] ?? '/login'} replace />
  }

  return children
}

// ── Root redirect based on role ─────────────────────────────────
function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <PageSpinner />
  if (!user)   return <Navigate to="/login" replace />
  const roleHome = { admin: '/admin', lecturer: '/lecturer', student: '/student' }
  return <Navigate to={roleHome[user.role] ?? '/login'} replace />
}

// ── App Router ─────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* PWA: update available banner (top) */}
        <UpdateBanner />

        <Suspense fallback={<PageSpinner />}>
          <Routes>
            {/* ─ Public ─ */}
            <Route path="/login"  element={<LoginPage />} />
            <Route path="/enroll" element={<EnrollPage />} />

            {/* ─ Root → role-based redirect ─ */}
            <Route path="/" element={<RootRedirect />} />

            {/* ─ Admin ─ */}
            <Route path="/admin" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="overview" />
              </ProtectedRoute>
            } />
            <Route path="/admin/courses" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="courses" />
              </ProtectedRoute>
            } />
            <Route path="/admin/students" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="students" />
              </ProtectedRoute>
            } />
            <Route path="/admin/tokens" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="tokens" />
              </ProtectedRoute>
            } />
            <Route path="/admin/conflicts" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="conflicts" />
              </ProtectedRoute>
            } />
            <Route path="/admin/export" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard defaultTab="export" />
              </ProtectedRoute>
            } />

            {/* ─ Lecturer ─ */}
            <Route path="/lecturer" element={
              <ProtectedRoute allowedRoles={['lecturer', 'admin']}>
                <LecturerDashboard defaultTab="overview" />
              </ProtectedRoute>
            } />
            <Route path="/lecturer/history" element={
              <ProtectedRoute allowedRoles={['lecturer', 'admin']}>
                <LecturerDashboard defaultTab="history" />
              </ProtectedRoute>
            } />
            <Route path="/lecturer/export" element={
              <ProtectedRoute allowedRoles={['lecturer', 'admin']}>
                <LecturerDashboard defaultTab="export" />
              </ProtectedRoute>
            } />
            {/* New session */}
            <Route path="/lecturer/session/new" element={
              <ProtectedRoute allowedRoles={['lecturer', 'admin']}>
                <SessionPage />
              </ProtectedRoute>
            } />
            {/* View existing session */}
            <Route path="/lecturer/session/:sessionId" element={
              <ProtectedRoute allowedRoles={['lecturer', 'admin']}>
                <SessionPage />
              </ProtectedRoute>
            } />
            {/* Batch scan — multi-face proximity scanner */}
            <Route path="/batch-scan/:sessionId/:courseCode" element={
              <ProtectedRoute allowedRoles={['lecturer', 'admin']}>
                <BatchScanPage />
              </ProtectedRoute>
            } />

            {/* ─ Student ─ */}
            <Route path="/student" element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            } />
            <Route path="/student/attendance" element={
              <ProtectedRoute allowedRoles={['student']}>
                <AttendancePage />
              </ProtectedRoute>
            } />

            {/* ─ 404 ─ */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>

        {/* PWA: global toast stack (portal, bottom-right) */}
        <ToastContainer />

        {/* PWA: install-to-homescreen banner (bottom) */}
        <InstallBanner />
      </AuthProvider>
    </BrowserRouter>
  )
}

