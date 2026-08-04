import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  getPlans,
  initPurchase,
  verifyPurchase,
  type TokenPlan,
} from "../api/wallet.js";
import { useAuth } from "../contexts/AuthContext.js";
import { openPaystackPopup } from "../paystack.js";
import { refreshBalance } from "../api/walletStore.js";
import {
  Page,
  Card,
  Button,
  RCoin,
  Stagger,
  StaggerItem,
} from "@/components/ui/index.js";

export function BuyTokens() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<TokenPlan[]>([]);
  const [publicKey, setPublicKey] = useState("");
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    getPlans().then((res) => {
      setPlans(res.plans);
      setPublicKey(res.paystackPublicKey);
    });
  }, []);

  async function handleBuy(plan: TokenPlan) {
    if (!user) return;
    setError("");
    setSuccessMessage("");
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
            if (result.status === "success") {
              setSuccessMessage(
                `Success! ${plan.tokens} R Coins added — new balance: ${result.tokenBalance}.`,
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
            setBusyPlanId(null);
          }
        },
        onCancel: () => setBusyPlanId(null),
      });
    } catch (err) {
      console.error("Purchase failed:", err);
      setError(
        err instanceof Error ? err.message : "Could not start purchase",
      );
      setBusyPlanId(null);
    }
  }

  return (
    <Page
      title="Buy R Coins"
      description="Top up your balance to wager, berserk, and enter tournaments."
      back="/"
      bare
    >
      <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Test mode — no real charge will be made. Use Paystack's test card
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

      {plans.length === 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} variant="solid" className="h-32 animate-pulse" />
          ))}
        </div>
      )}

      <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const isBusy = busyPlanId === plan.id;
          return (
            <StaggerItem key={plan.id}>
              <Card variant="solid" className="flex h-full flex-col">
                <div className="mb-4 flex items-center gap-2.5">
                  <RCoin size={30} />
                  <div>
                    <p className="text-lg font-bold leading-tight text-base-content">
                      {plan.tokens.toLocaleString()}
                    </p>
                    <p className="text-xs text-base-content/50">R Coins</p>
                  </div>
                </div>
                <p className="mb-4 text-sm text-base-content/60">
                  ₦{plan.priceNaira.toLocaleString()}
                </p>
                <Button
                  onClick={() => handleBuy(plan)}
                  disabled={busyPlanId !== null || !publicKey}
                  loading={isBusy}
                  fullWidth
                  className="mt-auto"
                >
                  {isBusy ? "Processing…" : "Buy"}
                </Button>
              </Card>
            </StaggerItem>
          );
        })}
      </Stagger>
    </Page>
  );
}
