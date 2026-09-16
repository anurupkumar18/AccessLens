/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API Gateway WebSocket endpoint for the live session service (.env.example). */
  readonly VITE_ACCESSLENS_WS_URL?: string;
  /** HTTPS endpoint of services/ai-gateway: Ask this class, Polly speech, Transcribe captions (.env.example). */
  readonly VITE_ACCESSLENS_AI_URL?: string;
  /** Base URL for versioned, reviewed Access Pack assets (.env.example). */
  readonly VITE_ACCESSLENS_ASSET_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
