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
  Spinner,
  RCoin,
} from "@/components/ui/index.js";

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

  useEffect(() => {
    getWalletConfig().then((res) => {
      setNairaPerToken(res.withdrawal.nairaPerToken);
      setMinTokens(res.withdrawal.minTokens);
    });
    getBanks().then((res) => setBanks(res.banks));
  }, []);

  // Debounced account resolution — fires once both fields look complete.
  useEffect(() => {
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
      setTokens("");
      setAccountNumber("");
      setBankCode("");
      setAccountName("");
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
      description="Cash out R Coins to your bank account."
      back="/"
      bare
    >
      <Card variant="solid" className="w-full space-y-3">
        <p className="mb-4 text-xs text-base-content/50">
          Rate: ₦{nairaPerToken} per R Coin · Minimum withdrawal: {minTokens} R
          Coins
        </p>

        <Input
          label="R Coins to withdraw"
          type="number"
          min={minTokens}
          max={balance ?? undefined}
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          leadingIcon={<RCoin size={16} />}
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
          leadingIcon={<Landmark className="h-4 w-4" />}
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
