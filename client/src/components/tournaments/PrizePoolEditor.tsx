import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  parsePrizePoolText,
  prizeTiersToText,
  tokensLabel,
  ordinalSuffix,
  type TournamentPrizeTier,
} from "../../api/tournaments.js";
import { HelpTip } from "../HelpTip.js";
import { RCoin } from "../ui/RCoin.js";
import { Textarea } from "../ui/index.js";

interface PrizePoolEditorProps {
  value: TournamentPrizeTier[];
  onChange: (tiers: TournamentPrizeTier[]) => void;
  /** Used only to flag a tier that reaches past the field cap, a hint,
   *  not a hard block; the real validation still happens on submit. */
  maxPlayers: number;
}

/** A single free-form textarea that replaces the old "add a row per prize
 *  tier" UI. One line per tier, "1st - 500", "2nd - 200", "5th-10th - 4k",
 *  parsed live via parsePrizePoolText. Shared between the create form and
 *  the edit form so the parsing behavior can never drift between the two. */
export function PrizePoolEditor({
  value,
  onChange,
  maxPlayers,
}: PrizePoolEditorProps) {
  const [text, setText] = useState(() => prizeTiersToText(value));
  const [errors, setErrors] = useState<string[]>([]);

  function handleChange(next: string) {
    setText(next);
    const { tiers, errors } = parsePrizePoolText(next);
    setErrors(errors);
    onChange(tiers);
  }

  const total = value.reduce(
    (sum, t) => sum + t.tokens * (t.toRank - t.fromRank + 1),
    0,
  );
  const overflowTier = value.find((t) => t.toRank > maxPlayers);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-sm text-base-content/80">
          <span className="text-xs font-medium sm:text-sm">Prize pool</span>
          <HelpTip>
            One place (or range of places) per line: rank, then how much it
            pays. "1st - 500", "2nd - 200", or "5th-10th - 4k" for a range that
            shares the same amount. Ordinal suffixes and spacing don't matter.
            "5-10-4000" parses exactly the same as "5th-10th-4k".
          </HelpTip>
        </span>
        {total > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-base-content/50">
            {total} <RCoin size={12} /> total
          </span>
        )}
      </div>

      <Textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={"1st - 500\n2nd - 200\n3rd - 100\n4th-10th - 25"}
        rows={5}
        className="font-mono"
      />

      {errors.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Couldn't understand{" "}
            {errors.map((line, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="font-mono">"{line}"</span>
              </span>
            ))}{" "}
            , so it was left out of the prize pool.
          </span>
        </div>
      )}

      {overflowTier && (
        <p className="text-xs text-amber-500">
          {overflowTier.toRank}
          {ordinalSuffix(overflowTier.toRank)} place is past your {maxPlayers}
          -player cap. Raise the cap or trim the schedule before saving.
        </p>
      )}

      {value.length === 0 && errors.length === 0 && (
        <p className="text-sm text-base-content/40">No prize tiers yet </p>
      )}

      {value.length > 0 && (
        <div className="space-y-1 rounded-lg bg-base-100/60 px-3 py-2">
          {value.map((tier, i) => (
            <div
              key={i}
              className="flex justify-between text-xs text-base-content/70"
            >
              <span>
                {tier.fromRank === tier.toRank
                  ? `${tier.fromRank}${ordinalSuffix(tier.fromRank)} place`
                  : `${tier.fromRank}${ordinalSuffix(tier.fromRank)}–${tier.toRank}${ordinalSuffix(tier.toRank)} place`}
              </span>
              <span className="font-medium text-base-content flex items-center">
                {tier.tokens} <RCoin size={12} className="ml-1" />
                <span className="ml-1 opacity-85 text-xs">
                  {tokensLabel(tier).slice(1)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
