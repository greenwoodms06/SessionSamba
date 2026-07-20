import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves from /<repo>/. Override with BASE_PATH when the repo
// name differs, or set it to '/' for a user/org page or a custom domain.
const base = process.env.BASE_PATH ?? '/MyConferencePlan/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // SPEC sect. 8.1: force-update, never sit in `waiting`
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'MyConferencePlan',
        short_name: 'MyConfPlan',
        description: 'Plan your conference schedule offline.',
        theme_color: '#111827',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json}'],
        // Conference data is precached with the shell so the app works on a
        // show floor with no wifi, but revalidated when there IS a network so
        // a schedule change reaches the user (SPEC sect. 8.1).
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
