import { useEffect, useState } from "react";
import { CheckCircle2, Landmark, Phone, XCircle } from "lucide-react";
import {
  getBanks,
  resolveAccount,
  getPayoutAccount,
  savePayoutAccount,
  type Bank,
} from "../api/wallet.js";
import { ApiRequestError } from "../api/http.js";
import { Page, Card, Button, Input, Select, Spinner } from "@/components/ui/index.js";

/**
 * Where naira tournament prizes get sent. Same bank-lookup shape as
 * Withdraw.tsx (bank select + account number -> resolved account name),
 * but this one actually persists to the account (via PUT
 * /wallet/payout-account) rather than firing a Paystack transfer on the
 * spot, plus a phone number so we can reach the winner directly. Reachable
 * either from a "you won ₦X" notification link, or any time from the
 * Withdraw page (see the link there).
 */
export function AccountDetails() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [phone, setPhone] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  // Same reasoning as Withdraw.tsx's skipNextResolve: don't let the
  // debounced resolve effect stomp the name we just loaded from the saved
  // account with a redundant (but not-yet-arrived) lookup.
  const [skipNextResolve, setSkipNextResolve] = useState(false);

  useEffect(() => {
    getBanks().then((res) => setBanks(res.banks));
    getPayoutAccount()
      .then((res) => {
        if (res.payoutAccount) {
          setSkipNextResolve(true);
          setBankCode(res.payoutAccount.bankCode);
          setAccountNumber(res.payoutAccount.accountNumber);
          setAccountName(res.payoutAccount.accountName);
          setPhone(res.payoutAccount.phone);
        }
      })
      .finally(() => setLoading(false));
  }, []);

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

  const bankName = banks.find((b) => b.code === bankCode)?.name ?? "";
  const canSubmit =
    !!bankCode &&
    !!accountName &&
    phone.trim().length >= 7 &&
    !resolving &&
    !submitting;

  async function handleSubmit() {
    setError("");
    setSuccessMessage("");
    setSubmitting(true);
    try {
      await savePayoutAccount({
        bankCode,
        bankName,
        accountNumber,
        accountName,
        phone: phone.trim(),
      });
      setSuccessMessage("Account details saved.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save account details",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page
      title="Payout account details"
      description="Where we send your naira tournament winnings, disbursed manually by our team."
      back="/withdraw"
      bare
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <Card variant="solid" className="w-full space-y-3">
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

          <Input
            label="Phone number"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            leadingIcon={<Phone className="h-4 w-4 mb-1.5" />}
            hint="So we can reach you about your winnings"
            placeholder="e.g. 08012345678"
            className="mb-1"
          />

          {error && (
            <div className="mb-3.5 mt-3.5 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          {successMessage && (
            <div className="mb-3.5 mt-3.5 flex items-start gap-2 rounded-xl border border-green-500/25 bg-green-500/10 px-3.5 py-2.5 text-sm text-green-400">
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
            {submitting ? "Saving…" : "Save account details"}
          </Button>
        </Card>
      )}
    </Page>
  );
}
