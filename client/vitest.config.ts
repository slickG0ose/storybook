import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // vite-plugin-pwa is not in the Vitest plugin chain, so its virtual module has
      // nothing to resolve against. Point the specifier at a stub so both the component
      // import and `vi.mock('virtual:pwa-register/react')` land on the same module id.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegisterStub.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
