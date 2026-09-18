import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Which build is this? Without an answer visible in the app, a stale service
// worker is indistinguishable from a bug — which cost real time: a fix was
// reported three times as "still broken" while the browser was running code
// from before it.
//
// Vercel sets VERCEL_GIT_COMMIT_SHA; locally we ask git. Neither is fatal.
function buildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__:   JSON.stringify(buildId()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
