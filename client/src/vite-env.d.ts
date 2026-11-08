/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // Commit SHA of the client build (deploy-pages.yml). Unset in local dev, so
  // feedback reports carry client_build: null.
  readonly VITE_APP_COMMIT?: string
}
