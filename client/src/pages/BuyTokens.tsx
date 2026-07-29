import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPlans, initPurchase, verifyPurchase, type TokenPlan } from '../api/wallet.js';
import { useAuth } from '../contexts/AuthContext.js';
import { openPaystackPopup } from '../paystack.js';
import { refreshBalance } from '../api/walletStore.js';

export function BuyTokens() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TokenPlan[]>([]);
  const [publicKey, setPublicKey] = useState('');
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    getPlans().then((res) => {
      setPlans(res.plans);
      setPublicKey(res.paystackPublicKey);
    });
  }, []);

  async function handleBuy(plan: TokenPlan) {
    if (!user) return;
    setError('');
    setSuccessMessage('');
    setBusyPlanId(plan.id);

    try {
      const { reference, amountKobo } = await initPurchase(plan.id);

      openPaystackPopup({
        key: publicKey,
        email: user.email,
        amount: amountKobo,
        ref: reference,
        onSuccess: async () => {
          try {
            const result = await verifyPurchase(reference);
            if (result.status === 'success') {
              setSuccessMessage(`Success! ${plan.tokens} R tokens added — new balance: ${result.tokenBalance}.`);
              await refreshBalance();
            } else {
              setError('Payment did not complete successfully. If you were charged, contact support with reference ' + reference);
            }
          } catch (err) {
            console.error('Verification failed:', err);
            setError(err instanceof Error ? err.message : 'Could not verify payment');
          } finally {
            setBusyPlanId(null);
          }
        },
        onCancel: () => setBusyPlanId(null),
      });
    } catch (err) {
      console.error('Purchase failed:', err);
      setError(err instanceof Error ? err.message : 'Could not start purchase');
      setBusyPlanId(null);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-base-300 bg-base-200 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-base-content">Buy R Tokens</h1>
          <div className="flex gap-3 text-sm">
            <Link to="/wallet/transactions" className="text-blue-400 hover:underline">
              Transactions
            </Link>
            <Link to="/wallet/withdraw" className="text-blue-400 hover:underline">
              Withdraw
            </Link>
          </div>
        </div>

        <p className="mb-4 text-xs text-amber-400">
          Test mode — no real charge will be made. Use Paystack's test card numbers.
        </p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        {successMessage && <p className="mb-3 text-sm text-green-400">{successMessage}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-lg border border-base-300 bg-base-100 p-4">
              <p className="text-lg font-bold text-base-content">{plan.tokens} tokens</p>
              <p className="mb-3 text-sm text-base-content/60">₦{plan.priceNaira.toLocaleString()}</p>
              <button
                onClick={() => handleBuy(plan)}
                disabled={busyPlanId !== null || !publicKey}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
              >
                {busyPlanId === plan.id ? 'Processing…' : 'Buy'}
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate('/')}
          className="mt-4 text-sm text-base-content/60 hover:text-base-content"
        >
          ← Back to dashboard
        </button>
      </div>
    </div>
  );
}
