import { useNavigate } from "react-router-dom";
import { Tabs, RCoin } from "@/components/ui/index.js";
import { useTokenBalance } from "@/hooks/useTokenBalance.js";

const WALLET_TABS = [
  { value: "/wallet/buy", label: "Buy" },
  { value: "/wallet/withdraw", label: "Withdraw" },
  { value: "/wallet/transactions", label: "History" },
];

/** Sits at the top of the three wallet pages (Buy / Withdraw / Transactions),
 *  mounted once by WalletLayout.tsx so it stays put across navigation
 *  between them instead of remounting per page. `active` is the current
 *  route; Tabs' shared layoutId gives the pill its slide animation between
 *  tabs since this one instance just re-renders with a new `value`. */
export function WalletNav({ active }: { active: string }) {
  const navigate = useNavigate();
  const { balance } = useTokenBalance();

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <RCoin size={30} />
        <div className="leading-tight">
          <p className="text-xs text-base-content/50">Balance</p>
          <p className="text-lg font-bold text-base-content">
            {balance ?? "…"}
          </p>
        </div>
      </div>
      <Tabs items={WALLET_TABS} value={active} onChange={(v) => navigate(v)} />
    </div>
  );
}
