// Thin typed wrapper around Paystack's Inline popup (loaded via <script> in
// index.html — it attaches window.PaystackPop, there's no npm package for it).

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

declare global {
  interface Window {
    PaystackPop?: {
      setup: (params: PaystackSetupParams) => PaystackHandler;
    };
  }
}

export function openPaystackPopup(params: PaystackSetupParams): void {
  if (!window.PaystackPop) {
    throw new Error('Paystack failed to load. Check your internet connection and try again.');
  }
  const handler = window.PaystackPop.setup({
    ...params,
    currency: params.currency ?? 'NGN',
  });
  handler.openIframe();
}
