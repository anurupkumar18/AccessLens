/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API Gateway WebSocket endpoint for the live session service (.env.example). */
  readonly VITE_ACCESSLENS_WS_URL?: string;
  /** HTTPS endpoint of services/ai-gateway: Ask this class, Polly speech, Transcribe captions (.env.example). */
  readonly VITE_ACCESSLENS_AI_URL?: string;
  /** Streaming Function URL of the student study chat (StudyChatUrl stack output). */
  readonly VITE_ACCESSLENS_CHAT_URL?: string;
  /** Base URL for versioned, reviewed Access Pack assets (.env.example). */
  readonly VITE_ACCESSLENS_ASSET_BASE_URL?: string;
  /** HTTP API for instructor authoring (.env.example). */
  readonly VITE_ACCESSLENS_API_URL?: string;
  /** Google OAuth web client id instructors sign in with (.env.example, D12). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Local hosting only: pack to show at the bare origin (.env.example). */
  readonly VITE_ACCESSLENS_PACK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
