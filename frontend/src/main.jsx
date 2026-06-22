import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { startSyncManager } from './lib/sync/syncQueue'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// ── Offline-first Sync Manager ────────────────────────────────
// Starts watching online/offline events and drains the attendance
// queue automatically whenever the device reconnects.
startSyncManager()

// ── PWA Service Worker Registration ──────────────────────────
// Registered after render to avoid blocking first paint.
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      onNeedRefresh() {
        console.info('[PWA] New version available. Refreshing…')
      },
      onOfflineReady() {
        console.info('[PWA] App is ready for offline use.')
      },
    })
  }).catch(() => {
    // Not in PWA build mode (dev) — silently ignore
  })
}
