/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MASTER_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
