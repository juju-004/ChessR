// Thin typed wrapper around Paystack's Inline popup (loaded via <script> in
// index.html — it attaches window.PaystackPop, there's no npm package for the
// v1 API this project uses).
//
// IMPORTANT: this is the v1 "PaystackPop.setup()" API (matches the
// v1/inline.js script loaded in index.html), which uses `callback` and
// `onClose` as its callback keys. Paystack's newer `PaystackPop.newTransaction()`
// API (a different object entirely, from the @paystack/inline-js npm package)
// uses `onSuccess`/`onCancel` instead — those names don't exist on `.setup()`
// and are silently ignored if passed to it, which is exactly what caused
// purchases to hang on "Processing..." forever regardless of the outcome.
// Our own public wrapper API below keeps the nicer onSuccess/onCancel names;
// the translation to Paystack's actual callback/onClose happens internally.

interface PaystackSetupParams {
  key: string;
  email: string;
  amount: number; // kobo
  ref: string;
  currency?: string;
  onSuccess: (transaction: { reference: string }) => void;
  onCancel: () => void;
}

interface PaystackHandler {
  openIframe: () => void;
}

interface PaystackNativeSetupParams {
  key: string;
  email: string;
  amount: number;
  ref: string;
  currency: string;
  callback: (response: { reference: string }) => void;
  onClose: () => void;
}

declare global {
  interface Window {
    PaystackPop?: {
      setup: (params: PaystackNativeSetupParams) => PaystackHandler;
    };
  }
}

export function openPaystackPopup(params: PaystackSetupParams): void {
  attemptOpen(params, 0);
}

const MAX_WAIT_ATTEMPTS = 10; // ~2s total (10 * 200ms) before giving up

function attemptOpen(params: PaystackSetupParams, attempt: number): void {
  if (window.PaystackPop) {
    const handler = window.PaystackPop.setup({
      key: params.key,
      email: params.email,
      amount: params.amount,
      ref: params.ref,
      currency: params.currency ?? 'NGN',
      // Wrapped in a plain (non-async) function on purpose: our onSuccess
      // handler in BuyTokens.tsx is declared `async () => {...}`. typeof an
      // async function is still 'function', but its actual constructor is
      // AsyncFunction, not Function — Paystack's validator here rejects that
      // with "Attribute callback must be a valid function" even though
      // typeof-based checks would call it fine. Wrapping guarantees Paystack
      // always receives a genuinely plain Function, regardless of what kind
      // of function the caller passed in.
      callback: (response: { reference: string }) => {
        void params.onSuccess(response);
      },
      onClose: () => {
        params.onCancel();
      },
    });
    handler.openIframe();
    return;
  }

  if (attempt >= MAX_WAIT_ATTEMPTS) {
    throw new Error(
      'Paystack failed to load. This is usually an ad blocker or privacy extension blocking js.paystack.co — try disabling it for this site, or use a different browser, then try again.',
    );
  }

  // The script tag in index.html has no async/defer, so it's render-blocking
  // and should already be loaded by the time any button click is possible —
  // but a brief retry window costs nothing and covers a genuine edge case
  // (very slow initial script fetch) rather than failing instantly.
  setTimeout(() => attemptOpen(params, attempt + 1), 200);
}
