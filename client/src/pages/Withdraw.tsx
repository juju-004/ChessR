import { useEffect, useState } from "react";
import { CheckCircle2, Landmark, XCircle } from "lucide-react";
import {
  getWalletConfig,
  getBanks,
  resolveAccount,
  withdraw,
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
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [rememberDetails, setRememberDetails] = useState(
    () => readSavedAccount() !== null,
  );
  // The debounced account-resolution effect below treats every accountNumber/
  // bankCode change as "go resolve this", which would immediately overwrite
  // the accountName we're about to prefill from storage with a fresh (but
  // identical) lookup. This just tells that effect to skip its very first
  // run so the restored name sticks without a flash of the resolving spinner.
  const [skipNextResolve, setSkipNextResolve] = useState(false);

  useEffect(() => {
    getWalletConfig().then((res) => {
      setNairaPerToken(res.withdrawal.nairaPerToken);
      setMinTokens(res.withdrawal.minTokens);
    });
    getBanks().then((res) => setBanks(res.banks));

    const saved = readSavedAccount();
    if (saved) {
      setSkipNextResolve(true);
      setBankCode(saved.bankCode);
      setAccountNumber(saved.accountNumber);
      setAccountName(saved.accountName);
    }
  }, []);

  // Debounced account resolution, fires once both fields look complete.
  useEffect(() => {
    if (skipNextResolve) {
      setSkipNextResolve(false);
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
    !!accountName &&
    !resolving &&
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
        accountName,
      });
      setSuccessMessage(
        result.status === "success"
          ? `Withdrawal of ₦${result.amountNaira.toLocaleString()} sent.`
          : `Withdrawal submitted and is being processed (status: ${result.status}).`,
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
      description={
        <span className="inline-flex items-center gap-1">
          <span>Cash</span> out <RCoin size={13} /> Coins <span>to your</span>
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
          withdrawal: {minTokens} <RCoin size={11} /> Coins
        </p>

        <Input
          label="Coins to withdraw"
          type="number"
          min={minTokens}
          max={balance ?? undefined}
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          leadingIcon={<RCoin size={16} className="mb-3" />}
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

        <Switch
          checked={rememberDetails}
          onChange={setRememberDetails}
          label="Remember my account details"
          description="Save this bank and account number on this device for next time."
          className="mb-3.5 mt-7"
        />

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
          {submitting ? "Processing…" : "Withdraw"}
        </Button>
      </Card>
    </Page>
  );
}
