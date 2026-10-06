import { defineConfig } from 'vitest/config'

// Network tests against the real media APIs: npm run test:live
export default defineConfig({
  test: { include: ['tests-live/**/*.test.ts'], environment: 'node', testTimeout: 180000 }
})
