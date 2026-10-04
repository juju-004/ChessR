import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, XCircle } from "lucide-react";
import {
  getWalletConfig,
  getBanks,
  resolveAccount,
  withdraw,
  getWithdrawStatus,
  type Bank,
} from "../api/wallet.js";
import { ApiRequestError } from "../api/http.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import {
  Page,
  Card,
  Button,
  Input,
  Select,
  Switch,
  Spinner,
  RCoin,
} from "@/components/ui/index.js";

// Persisted locally (same pattern as balanceVisibilityStore.ts), never sent
// anywhere but the withdraw request itself, this just saves someone from
// retyping their account number and re-selecting their bank on every
// withdrawal.
const REMEMBER_KEY = "chess-app:withdraw-account";

interface SavedAccount {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

function readSavedAccount(): SavedAccount | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.bankCode === "string" &&
      typeof parsed?.accountNumber === "string" &&
      typeof parsed?.accountName === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function Withdraw() {
  const { balance, refresh: refreshBalance } = useTokenBalance();
  const [nairaPerToken, setNairaPerToken] = useState(0);
  const [minTokens, setMinTokens] = useState(0);
  const [banks, setBanks] = useState<Bank[]>([]);

  const [tokens, setTokens] = useState("");
  // Saved details are read once, up front, so the very first render already
  // has them (previously they were restored in an effect, which raced the
  // lookup effect below and wiped the restored account name).
  const savedRef = useRef<SavedAccount | null>(readSavedAccount());
  const [bankCode, setBankCode] = useState(savedRef.current?.bankCode ?? "");
  const [accountNumber, setAccountNumber] = useState(
    savedRef.current?.accountNumber ?? "",
  );
  const [accountName, setAccountName] = useState(
    savedRef.current?.accountName ?? "",
  );
  const [withdrawBlockReason, setWithdrawBlockReason] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [rememberDetails, setRememberDetails] = useState(
    () => readSavedAccount() !== null,
  );
  useEffect(() => {
    getWalletConfig().then((res) => {
      setNairaPerToken(res.withdrawal.nairaPerToken);
      setMinTokens(res.withdrawal.minTokens);
    });
    getBanks().then((res) => setBanks(res.banks));
    getWithdrawStatus()
      .then((res) =>
        setWithdrawBlockReason(res.eligible ? "" : (res.reason ?? "")),
      )
      .catch(() => {}); // non-fatal, the server enforces the rule on submit anyway
  }, []);

  // Debounced account resolution, fires once both fields look complete.
  useEffect(() => {
    // Restored from storage and untouched: keep the saved name, no lookup.
    const saved = savedRef.current;
    if (
      saved &&
      saved.accountNumber === accountNumber &&
      saved.bankCode === bankCode
    ) {
      setAccountName(saved.accountName);
      setResolveError("");
      return;
    }
    setAccountName("");
    setResolveError("");
    if (accountNumber.length !== 10 || !bankCode) return;

    setResolving(true);
    const timer = setTimeout(() => {
      resolveAccount(accountNumber, bankCode)
        .then((res) => setAccountName(res.account_name))
        .catch((err) =>
          setResolveError(
            err instanceof ApiRequestError
              ? err.message
              : "Could not resolve account",
          ),
        )
        .finally(() => setResolving(false));
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountNumber, bankCode]);

  const tokensNum = Number(tokens);
  const estimatedNaira = tokensNum > 0 ? tokensNum * nairaPerToken : 0;
  const canSubmit =
    tokensNum >= minTokens &&
    balance !== null &&
    tokensNum <= balance &&
    !!bankCode &&
    accountNumber.length === 10 &&
    !withdrawBlockReason &&
    !submitting;

  async function handleSubmit() {
    setError("");
    setSuccessMessage("");
    setSubmitting(true);
    try {
      const result = await withdraw({
        tokens: tokensNum,
        accountNumber,
        bankCode,
        bankName: banks.find((b) => b.code === bankCode)?.name,
        accountName: accountName || undefined,
      });
      setSuccessMessage(
        `Withdrawal request of ₦${result.amountNaira.toLocaleString()} submitted. It's pending while we send it to your bank, track it under Transactions.`,
      );
      if (rememberDetails) {
        try {
          localStorage.setItem(
            REMEMBER_KEY,
            JSON.stringify({ bankCode, accountNumber, accountName }),
          );
        } catch {
          // Non-fatal, the withdrawal itself already went through.
        }
      } else {
        savedRef.current = null;
        try {
          localStorage.removeItem(REMEMBER_KEY);
        } catch {
          // Non-fatal.
        }
        setBankCode("");
        setAccountNumber("");
        setAccountName("");
      }
      setTokens("");
      await refreshBalance();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Withdrawal failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page
      title="Withdraw"
      responsiveDescription
      description={
        <span className="inline-flex flex-wrap items-center gap-1">
          <span>Cash</span> out <RCoin size={13} /> Coins <span>to</span>
          <span>your</span>
          <span>bank</span>
          <span>account.</span>
        </span>
      }
      back="/"
      bare
    >
      <Card variant="solid" className="w-full space-y-3">
        <p className="mb-4 flex flex-wrap items-center gap-1 text-xs text-base-content/50">
          Rate: ₦{nairaPerToken} per <RCoin size={11} /> Coin · Minimum
          withdrawal: {minTokens} <RCoin size={11} /> Coins · Payouts are
          processed manually
        </p>

        <Input
          label="Coins to withdraw"
          type="number"
          min={minTokens}
          max={balance ?? undefined}
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          leadingIcon={<RCoin size={16} className="mb-3" />}
          error={
            balance !== null && tokensNum > balance
              ? "You can't withdraw more than your balance"
              : undefined
          }
          hint={
            tokensNum > 0 ? `≈ ₦${estimatedNaira.toLocaleString()}` : undefined
          }
          className="mb-3.5"
        />

        <Select
          label="Bank"
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          className="mb-3.5"
        >
          <option value="">Select a bank…</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>

        <Input
          label="Account number"
          type="text"
          inputMode="numeric"
          maxLength={10}
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
          leadingIcon={<Landmark className="h-4 w-4 mb-1.5" />}
          trailingIcon={resolving ? <Spinner size="sm" /> : undefined}
          error={resolveError || undefined}
          hint={
            !resolveError && accountName ? undefined : "10-digit account number"
          }
          className="mb-1"
        />
        {accountName && (
          <p className="mb-3.5 flex items-center gap-1.5 text-sm text-green-400">
            <CheckCircle2 className="h-4 w-4" /> {accountName}
          </p>
        )}
        {!accountName &&
          accountNumber.length === 10 &&
          !!bankCode &&
          !resolving && (
            <p className="mb-3.5 flex items-start gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              We couldn't verify this account name. Please double-check the
              details, payouts sent to wrong details can't be recovered.
            </p>
          )}

        <Switch
          checked={rememberDetails}
          onChange={setRememberDetails}
          label="Remember my account details"
          description="Save this bank and account number on this device for next time."
          className="mb-3.5 mt-7"
        />

        {withdrawBlockReason && (
          <div className="mb-3.5 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-500">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{withdrawBlockReason}</p>
          </div>
        )}
        {error && (
          <div className="mb-3.5 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {successMessage && (
          <div className="mb-3.5 flex items-start gap-2 rounded-xl border border-green-500/25 bg-green-500/10 px-3.5 py-2.5 text-sm text-green-400">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{successMessage}</p>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
          fullWidth
          className="mt-4"
        >
          {submitting ? "Submitting…" : "Request withdrawal"}
        </Button>
      </Card>
    </Page>
  );
}
