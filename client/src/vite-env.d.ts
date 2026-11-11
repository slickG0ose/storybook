/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // Commit SHA of the client build (deploy-pages.yml). Unset in local dev, so
  // feedback reports carry client_build: null.
  readonly VITE_APP_COMMIT?: string
  // 'false' | '0' | 'off' | 'no' hides prices and the cart; read only via lib/commerce.ts.
  readonly VITE_COMMERCE_ENABLED?: string
}
