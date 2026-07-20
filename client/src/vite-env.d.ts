/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API base URL, e.g. "https://your-app.up.railway.app/api".
   *  Falls back to same-origin "/api" (works locally via the Vite proxy) if unset. */
  readonly VITE_API_BASE_URL?: string;
  /** Backend Socket.IO URL, e.g. "https://your-app.up.railway.app".
   *  Falls back to same-origin "/" (works locally via the Vite proxy) if unset. */
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
