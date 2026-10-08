import { Link } from "react-router-dom";
import { FORMAT_LABEL, formatTimeControl, type Tournament } from "../../api/tournaments.js";
import { Badge, RCoin, TimeControlIcon } from "../ui/index.js";

const STATUS_VARIANT: Record<
  Tournament["status"],
  "neutral" | "success" | "error"
> = {
  pending: "neutral",
  active: "success",
  finished: "neutral",
  cancelled: "error",
};

export function TournamentRow({ t }: { t: Tournament }) {
  // prizePoolTokens is always 0 for naira tournaments (nothing is ever
  // actually debited for one, see the ITournament doc comment server-side),
  // so the total has to be computed from the schedule itself here rather
  // than reading prizePoolTokens the way the R Coin case does below it.
  const nairaPrizeTotal =
    t.prizePoolCurrency === "naira"
      ? t.prizeSchedule.reduce(
          (sum, tier) => sum + tier.tokens * (tier.toRank - tier.fromRank + 1),
          0,
        )
      : 0;

  return (
    <Link
      to={`/tournaments/${t.code}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium break-words text-base-content">
            {t.name}
          </span>
          <Badge variant={STATUS_VARIANT[t.status]}>{t.status}</Badge>
          {t.team && <Badge variant="primary">In-house</Badge>}
          {t.teamBattle && <Badge variant="primary">Team battle</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-base-content/50">
          {t.organizationName ? `${t.organizationName} · ` : ""}
          {FORMAT_LABEL[t.format]} ·{" "}
          <TimeControlIcon
            baseMinutes={t.baseMinutes}
            size={12}
            className="inline-block align-[-2px]"
          />{" "}
          {formatTimeControl(t)}
          {/* No max-players figure anymore (fixed server-side cap), just
           *  how many have joined. */}
          {" "}
          · {t.playerCount ?? t.players.length} {(t.playerCount ?? t.players.length) === 1 ? "player" : "players"}
          {t.regFeeTokens > 0 && (
            <>
              {" "}
              · {t.regFeeTokens}{" "}
              <RCoin size={11} className="inline align-[-1px]" /> to join
            </>
          )}
          {t.prizePoolCurrency === "naira"
            ? nairaPrizeTotal > 0 && (
                <> · ₦{nairaPrizeTotal.toLocaleString()} prize pool</>
              )
            : t.prizePoolTokens > 0 && (
                <>
                  {" "}
                  · {t.prizePoolTokens}{" "}
                  <RCoin size={11} className="inline align-[-1px]" /> prize pool
                </>
              )}
        </div>
      </div>
    </Link>
  );
}

