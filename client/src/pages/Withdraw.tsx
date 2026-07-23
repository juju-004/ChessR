import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPlans, getBanks, resolveAccount, withdraw, type Bank } from '../api/wallet.js';
import { ApiRequestError } from '../api/http.js';
import { useTokenBalance } from '../hooks/useTokenBalance.js';

export function Withdraw() {
  const navigate = useNavigate();
  const { balance, refresh: refreshBalance } = useTokenBalance();
  const [nairaPerToken, setNairaPerToken] = useState(0);
  const [minTokens, setMinTokens] = useState(0);
  const [banks, setBanks] = useState<Bank[]>([]);

  const [tokens, setTokens] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    getPlans().then((res) => {
      setNairaPerToken(res.withdrawal.nairaPerToken);
      setMinTokens(res.withdrawal.minTokens);
    });
    getBanks().then((res) => setBanks(res.banks));
  }, []);

  // Debounced account resolution — fires once both fields look complete.
  useEffect(() => {
    setAccountName('');
    setResolveError('');
    if (accountNumber.length !== 10 || !bankCode) return;

    setResolving(true);
    const timer = setTimeout(() => {
      resolveAccount(accountNumber, bankCode)
        .then((res) => setAccountName(res.account_name))
        .catch((err) => setResolveError(err instanceof ApiRequestError ? err.message : 'Could not resolve account'))
        .finally(() => setResolving(false));
    }, 400);

    return () => clearTimeout(timer);
  }, [accountNumber, bankCode]);

  const tokensNum = Number(tokens);
  const estimatedNaira = tokensNum > 0 ? tokensNum * nairaPerToken : 0;
  const canSubmit =
    tokensNum >= minTokens &&
    balance !== null &&
    tokensNum <= balance &&
    !!accountName &&
    !resolving &&
    !submitting;

  async function handleSubmit() {
    setError('');
    setSuccessMessage('');
    setSubmitting(true);
    try {
      const result = await withdraw({ tokens: tokensNum, accountNumber, bankCode, accountName });
      setSuccessMessage(
        result.status === 'success'
          ? `Withdrawal of ₦${result.amountNaira.toLocaleString()} sent.`
          : `Withdrawal submitted and is being processed (status: ${result.status}).`,
      );
      setTokens('');
      setAccountNumber('');
      setBankCode('');
      setAccountName('');
      await refreshBalance();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-100">Withdraw</h1>
          <div className="flex gap-3 text-sm">
            <Link to="/wallet/buy" className="text-blue-400 hover:underline">
              Buy tokens
            </Link>
            <Link to="/wallet/transactions" className="text-blue-400 hover:underline">
              Transactions
            </Link>
          </div>
        </div>

        <p className="mb-1 text-sm text-neutral-400">
          Balance: <span className="font-semibold text-neutral-100">{balance ?? '…'}</span> tokens
        </p>
        <p className="mb-4 text-xs text-neutral-500">
          Rate: ₦{nairaPerToken} per token · Minimum withdrawal: {minTokens} tokens
        </p>

        <label className="mb-1 block text-sm text-neutral-400">Tokens to withdraw</label>
        <input
          type="number"
          min={minTokens}
          max={balance ?? undefined}
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          className="mb-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        />
        {tokensNum > 0 && (
          <p className="mb-3 text-xs text-neutral-500">≈ ₦{estimatedNaira.toLocaleString()}</p>
        )}

        <label className="mb-1 block text-sm text-neutral-400">Bank</label>
        <select
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        >
          <option value="">Select a bank…</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-sm text-neutral-400">Account number</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={10}
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
          className="mb-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        />
        {resolving && <p className="mb-3 text-xs text-neutral-500">Resolving account…</p>}
        {resolveError && <p className="mb-3 text-xs text-red-400">{resolveError}</p>}
        {accountName && <p className="mb-3 text-sm text-green-400">✓ {accountName}</p>}

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        {successMessage && <p className="mb-3 text-sm text-green-400">{successMessage}</p>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {submitting ? 'Processing…' : 'Withdraw'}
        </button>

        <button
          onClick={() => navigate('/dashboard')}
          className="mt-4 block text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Back to dashboard
        </button>
      </div>
    </div>
  );
}
