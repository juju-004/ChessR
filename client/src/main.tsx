import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

// Registering a service worker is one of the browser's baseline requirements
// for treating this as an installable PWA (alongside the manifest linked in
// index.html). Kept in its own guarded block — this must never throw and
// take the whole app down with it just because, say, the page was loaded
// over plain HTTP in local dev.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed (non-fatal):', err);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
