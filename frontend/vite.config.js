import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      // Enable dev mode so manifest is served correctly during development
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'FaceAttend — Unilorin Biometric Attendance',
        short_name: 'FaceAttend',
        description: 'Offline-first AI-powered facial recognition attendance system for the University of Ilorin.',
        theme_color: '#0a0a1a',
        background_color: '#0a0a1a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/offline.html',
        navigateFallbackDenylist: [/^\/api/, /^\/health/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'gstatic-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            // API calls: NetworkFirst with offline fallback
            urlPattern: ({ url }) => url.pathname.startsWith('/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ],
  optimizeDeps: {
    exclude: ['@vladmandic/human']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@vladmandic/human'))    return 'human'
          if (id.includes('@tensorflow/tfjs'))     return 'tfjs'
          if (id.includes('react-router-dom'))     return 'router'
          if (id.includes('dexie'))                return 'dexie'
        }
      }
    }
  }
})
