import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTransactions, type Transaction } from '../api/wallet.js';

const statusColors: Record<Transaction['status'], string> = {
  success: 'text-green-400',
  pending: 'text-amber-400',
  failed: 'text-red-400',
};

export function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTransactions(page, 20).then((res) => {
      setTransactions(res.transactions);
      setTotalPages(res.totalPages);
      setLoading(false);
    });
  }, [page]);

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-100">Transactions</h1>
          <div className="flex gap-3 text-sm">
            <Link to="/wallet/buy" className="text-blue-400 hover:underline">
              Buy tokens
            </Link>
            <Link to="/wallet/withdraw" className="text-blue-400 hover:underline">
              Withdraw
            </Link>
          </div>
        </div>

        {loading && <p className="text-sm text-neutral-400">Loading…</p>}
        {!loading && transactions.length === 0 && (
          <p className="text-sm text-neutral-400">No transactions yet.</p>
        )}

        {transactions.map((t) => (
          <div key={t._id} className="flex items-center justify-between border-b border-neutral-800 py-2 text-sm last:border-none">
            <div>
              <p className="text-neutral-200">
                {t.type === 'purchase' ? 'Purchase' : 'Withdrawal'} · {t.tokens} tokens
              </p>
              <p className="text-xs text-neutral-500">
                ₦{(t.amountKobo / 100).toLocaleString()} · {new Date(t.createdAt).toLocaleString()}
              </p>
              {t.status === 'failed' && t.failureReason && (
                <p className="text-xs text-red-400">{t.failureReason}</p>
              )}
            </div>
            <span className={`font-semibold uppercase ${statusColors[t.status]}`}>{t.status}</span>
          </div>
        ))}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md bg-neutral-700 px-3 py-1 text-neutral-100 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-neutral-400">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md bg-neutral-700 px-3 py-1 text-neutral-100 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
