import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Puzzle,
  Receipt,
  RotateCcw,
  Swords,
  Trophy,
  Users,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { Pagination } from "../components/Pagination.js";
import { getTransactions, type Transaction } from "../api/wallet.js";
import {
  Page,
  Card,
  Badge,
  type BadgeVariant,
  EmptyState,
  CenteredSpinner,
  Stagger,
  StaggerItem,
  RCoin,
} from "@/components/ui/index.js";

const statusVariant: Record<Transaction["status"], BadgeVariant> = {
  success: "success",
  pending: "warning",
  failed: "error",
};

const typeLabels: Record<Transaction["type"], string> = {
  purchase: "Purchase",
  withdrawal: "Withdrawal",
  wager_stake: "Wager staked",
  wager_payout: "Wager won",
  wager_refund: "Wager refunded",
  tournament_reg_fee: "Tournament registration fee",
  tournament_prize_fund: "Tournament prize pool funded",
  tournament_payout: "Tournament prize won",
  tournament_reg_revenue: "Tournament registration revenue",
  tournament_refund: "Tournament refund",
  puzzle_race_stake: "Puzzle race staked",
  puzzle_race_payout: "Puzzle race won",
  puzzle_race_refund: "Puzzle race refunded",
};

const typeIcons: Record<Transaction["type"], LucideIcon> = {
  purchase: ArrowDownToLine,
  withdrawal: ArrowUpFromLine,
  wager_stake: Swords,
  wager_payout: Trophy,
  wager_refund: RotateCcw,
  tournament_reg_fee: Users,
  tournament_prize_fund: Coins,
  tournament_payout: Trophy,
  tournament_reg_revenue: Coins,
  tournament_refund: RotateCcw,
  puzzle_race_stake: Puzzle,
  puzzle_race_payout: Trophy,
  puzzle_race_refund: RotateCcw,
};

// Whether a transaction type ADDS to the balance (+) or REMOVES from it (-)
//, shown as a colored sign next to the token amount so it's clear at a
// glance which way the tokens moved, not just how many.
const typeAddsTokens: Record<Transaction["type"], boolean> = {
  purchase: true,
  withdrawal: false,
  wager_stake: false,
  wager_payout: true,
  wager_refund: true,
  tournament_reg_fee: false,
  tournament_prize_fund: false,
  tournament_payout: true,
  tournament_reg_revenue: true,
  tournament_refund: true,
  puzzle_race_stake: false,
  puzzle_race_payout: true,
  puzzle_race_refund: true,
};

function isMoneyMovement(type: Transaction["type"]): boolean {
  return type === "purchase" || type === "withdrawal";
}

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
    <Page
      title="Transactions"
      responsiveDescription
      description="Every purchase, withdrawal, and wager on your account."
      back="/"
      bare
    >
      {loading && (
        <CenteredSpinner className="py-16" />
      )}

      {!loading && transactions.length === 0 && (
        <Card variant="solid">
          <EmptyState icon={Receipt}>No transactions yet.</EmptyState>
        </Card>
      )}

      {!loading && transactions.length > 0 && (
        <Stagger className="space-y-2">
          {transactions.map((t) => {
            const Icon = typeIcons[t.type];
            return (
              <StaggerItem key={t._id}>
                <Card variant="solid" className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--primary)/12 text-(--primary)">
                    {Icon ? <Icon className="h-4 w-4" /> : <></>}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-base-content">
                      {typeLabels[t.type]}
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-normal ${
                          typeAddsTokens[t.type]
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {typeAddsTokens[t.type] ? "+" : "-"}
                        <RCoin size={12} /> {t.tokens}
                      </span>
                    </p>
                    <p className="truncate text-xs text-base-content/50">
                      {isMoneyMovement(t.type)
                        ? `₦${(t.amountKobo / 100).toLocaleString()} · `
                        : ""}
                      {new Date(t.createdAt).toLocaleString()}
                    </p>
                    {t.type === "withdrawal" && t.status === "pending" && (
                      <p className="mt-0.5 text-xs text-amber-500">
                        Awaiting payout, we'll notify you once it's sent.
                      </p>
                    )}
                    {t.status === "failed" && t.failureReason && (
                      <p className="mt-0.5 text-xs text-red-400">
                        {t.failureReason}
                      </p>
                    )}
                  </div>

                  <Badge
                    variant={statusVariant[t.status]}
                    className="uppercase"
                  >
                    {t.status}
                  </Badge>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      <div className="mt-5">
        <Pagination
          page={page - 1}
          pageCount={totalPages}
          onPageChange={(p) => setPage(p + 1)}
        />
      </div>
    </Page>
  );
}
