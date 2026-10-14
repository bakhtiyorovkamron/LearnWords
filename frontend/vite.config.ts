import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Stamps public/sw.js with a hash of everything the build produced. A changed app → a changed
// sw.js → the browser installs the new service worker, which drops the old cache (see sw.js).
function serviceWorkerVersion(): Plugin {
  const hash = createHash('sha256')
  return {
    name: 'sw-version',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name]
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source)
      }
    },
    async writeBundle({ dir = 'dist' }) {
      const publicDir = fileURLToPath(new URL('./public', import.meta.url))
      for (const name of (await readdir(publicDir)).sort()) {
        if (name !== 'sw.js') hash.update(name).update(await readFile(path.join(publicDir, name)))
      }
      const file = path.join(dir, 'sw.js')
      const sw = await readFile(file, 'utf8')
      await writeFile(file, sw.replace("'__BUILD_ID__'", `'${hash.digest('hex').slice(0, 12)}'`))
    },
  }
}

// /api is proxied to the Go backend, so the refresh cookie is same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerVersion()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
        // Browser -> Vite is same-origin; drop Origin so backend CORS doesn't reject
        // requests when the site is opened via IP or domain instead of localhost.
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => req.removeHeader('origin'))
        },
      },
    },
  },
})
