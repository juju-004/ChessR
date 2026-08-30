import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  getWalletConfig,
  initPurchase,
  verifyPurchase,
} from "../api/wallet.js";
import { useAuth } from "../contexts/AuthContext.js";
import { openPaystackPopup } from "../paystack.js";
import { refreshBalance } from "../api/walletStore.js";
import { Page, Card, Button, Input, RCoin } from "@/components/ui/index.js";
import { MAX_WAGER_TOKENS } from "@/lib/limits.js";

// Fallback used only until getWalletConfig() resolves, the server's
// figure (₦5/Rabah Coin) is always what's actually charged; this just avoids
// a blank/zeroed price preview for the one render before that request lands.
const FALLBACK_NAIRA_PER_TOKEN = 5;
const FALLBACK_MIN_TOKENS = 10;
// 7-digit sanity ceiling on a single purchase, mirroring MAX_WAGER_TOKENS
// server-side, overridden below by whatever getWalletConfig actually
// returns, if it returns a tighter one.
const FALLBACK_MAX_TOKENS = MAX_WAGER_TOKENS;

// One-tap shortcuts for common amounts, purely a UI convenience over the
// same custom-amount flow everyone else uses, not a distinct purchasable
// thing like the old fixed plan tiers were.
const QUICK_AMOUNTS = [50, 100, 250, 500, 1000, 2500];

export function BuyTokens() {
  const { user } = useAuth();
  const [nairaPerToken, setNairaPerToken] = useState(FALLBACK_NAIRA_PER_TOKEN);
  const [minTokens, setMinTokens] = useState(FALLBACK_MIN_TOKENS);
  const [maxTokens, setMaxTokens] = useState(FALLBACK_MAX_TOKENS);
  const [publicKey, setPublicKey] = useState("");
  const [tokensInput, setTokensInput] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    getWalletConfig()
      .then((res) => {
        // Guard against an old/partial response shape rather than crashing
        // silently in the .then (which was the actual bug: the backend's
        // /wallet/plans hasn't been migrated to the new `purchase` field
        // yet, so `res.purchase` was undefined, the destructure threw, the
        // rejected promise had no .catch, and publicKey, and therefore the
        // button, never got set). Falls back to the constants above so the
        // page still works with an old-shape response, just without
        // treating that as fatal.
        if (res.purchase) {
          setNairaPerToken(res.purchase.nairaPerToken);
          setMinTokens(res.purchase.minTokens);
          // Still clamp to our own 7-digit sanity ceiling even if the
          // server ever sent something looser, this is a UI guard, not
          // the actual source of truth (that's server-side validation on
          // the purchase endpoint itself).
          setMaxTokens(
            res.purchase.maxTokens
              ? Math.min(res.purchase.maxTokens, MAX_WAGER_TOKENS)
              : FALLBACK_MAX_TOKENS,
          );
        }
        setPublicKey(res.paystackPublicKey);
      })
      .catch((err) => {
        console.error("Failed to load wallet config:", err);
        setError("Couldn't load purchase settings. Try refreshing the page.");
      });
  }, []);

  const tokens = Math.max(0, Math.floor(Number(tokensInput) || 0));
  const priceNaira = tokens * nairaPerToken;
  const isValidAmount = tokens >= minTokens && tokens <= maxTokens;

  async function handleBuy() {
    if (!user || !isValidAmount) return;
    setError("");
    setSuccessMessage("");
    setBusy(true);

    try {
      const {
        reference,
        amountKobo,
        tokens: purchasedTokens,
      } = await initPurchase(tokens);

      openPaystackPopup({
        key: publicKey,
        email: user.email,
        amount: amountKobo,
        ref: reference,
        onSuccess: async () => {
          try {
            const result = await verifyPurchase(reference);
            if (result.status === "success") {
              setSuccessMessage(
                `Success! ${purchasedTokens} Rabah Coins added, new balance: ${result.tokenBalance}.`,
              );
              await refreshBalance();
            } else {
              setError(
                "Payment did not complete successfully. If you were charged, contact support with reference " +
                  reference,
              );
            }
          } catch (err) {
            console.error("Verification failed:", err);
            setError(
              err instanceof Error ? err.message : "Could not verify payment",
            );
          } finally {
            setBusy(false);
          }
        },
        onCancel: () => setBusy(false),
      });
    } catch (err) {
      console.error("Purchase failed:", err);
      setError(err instanceof Error ? err.message : "Could not start purchase");
      setBusy(false);
    }
  }

  return (
    <Page
      title={
        <span className="inline-flex items-center gap-1">
          Buy <RCoin size={18} /> Coins
        </span>
      }
      description={
        <span className="inline-flex items-center gap-1">
          Fixed rate: ₦{nairaPerToken} per <RCoin size={13} /> Coin.
        </span>
      }
      back="/"
      bare
    >
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Test mode. No real charge will be made. Use Paystack's test card
          numbers.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-400">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {successMessage && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-green-500/25 bg-green-500/10 px-3.5 py-2.5 text-sm text-green-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      <Card variant="solid">
        <div className="mb-5 flex items-center gap-2.5">
          <RCoin size={30} />
          <div>
            <p className="text-lg font-bold leading-tight text-base-content">
              Coins
            </p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-base-content/50">
              ₦{nairaPerToken} per <RCoin size={10} /> Coin · minimum{" "}
              {minTokens} <RCoin size={10} />
            </p>
          </div>
        </div>

        <Input
          label={
            <span className="inline-flex items-center gap-1">
              How many <RCoin size={12} /> Coins
            </span>
          }
          type="number"
          min={minTokens}
          max={maxTokens}
          step={1}
          value={tokensInput}
          onChange={(e) => setTokensInput(e.target.value)}
          error={
            !isValidAmount && tokensInput !== ""
              ? tokens > maxTokens
                ? `Maximum purchase is ${maxTokens.toLocaleString()} Rabah Coins.`
                : `Minimum purchase is ${minTokens} Rabah Coins.`
              : undefined
          }
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_AMOUNTS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setTokensInput(String(amount))}
              className={`rounded-full flex gap-1 items-center border px-3 py-1 text-xs font-medium transition-colors ${
                tokens === amount
                  ? "border-(--secondary)/50 bg-(--secondary)/10 text-base-content"
                  : "border-base-300 bg-base-100/60 text-base-content/70 hover:border-(--secondary)/30"
              }`}
            >
              {amount.toLocaleString()} <RCoin size={10} />
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-base-300 bg-base-100/60 px-3.5 py-3">
          <span className="text-sm text-base-content/60">You'll pay</span>
          <span className="text-lg font-bold text-base-content">
            ₦{priceNaira.toLocaleString()}
          </span>
        </div>

        <Button
          onClick={handleBuy}
          disabled={!isValidAmount || busy || !publicKey}
          loading={busy}
          fullWidth
          className="mt-4"
        >
          {busy ? (
            "Processing…"
          ) : (
            <span className="inline-flex items-center gap-1">
              Buy {tokens.toLocaleString()} <RCoin size={13} /> Coins
            </span>
          )}
        </Button>
      </Card>
    </Page>
  );
}
