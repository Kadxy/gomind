/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Relay WebSocket base URL, no trailing slash. Defaults to same-origin. */
  readonly VITE_RELAY_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
