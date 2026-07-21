import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves from /<repo>/. Override with BASE_PATH when the repo
// name differs, or set it to '/' for a user/org page or a custom domain.
const base = process.env.BASE_PATH ?? '/SessionSamba/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // SPEC sect. 8.1: force-update, never sit in `waiting`
      includeAssets: ['favicon.svg', 'icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'SessionSamba',
        short_name: 'SessionSamba',
        description: 'Plan your conference schedule offline.',
        // The light --page token; index.html carries a per-scheme pair.
        theme_color: '#e9ebef',
        background_color: '#e9ebef',
        display: 'standalone',
        start_url: base,
        scope: base,
        // PNG first — some installers ignore SVG icons. The art is full-bleed
        // with content in the safe zone, so one file serves any + maskable.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the app shell + the manifest + the default conference only.
        // Other conferences load on demand and cache at runtime, so the offline
        // footprint doesn't grow with every conference in the repo.
        globPatterns: ['**/*.{js,css,html,svg}', 'data/index.json', 'data/siggraph-2026/*.json'],
        // Any conference data (default or on-demand) is revalidated when online
        // so a schedule change reaches the user (SPEC sect. 8.1).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'conference-data' },
          },
        ],
      },
    }),
  ],
})
