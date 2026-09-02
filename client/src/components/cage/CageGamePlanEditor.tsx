import { useState } from "react";
import { ArrowDown, ArrowUp, ListPlus, X } from "lucide-react";
import {
  formatLegTimeControl,
  CATEGORY_LABEL,
  type CageLegPlan,
  type CageVariant,
  type LegCategory,
} from "../../api/cageMatches.js";
import { HelpTip } from "../HelpTip.js";
import { Select, Input, Button, Badge, CategoryIcon } from "../ui/index.js";
// Shared with every other time-control select in the app (see
// ../../timeControls.js) instead of keeping its own list, a cage leg's
// base time must be 1-180 minutes (or unlimited) server-side, so Hyper
// Bullet's ½-minute preset is filtered out here since it isn't a valid
// leg length, everything else from the shared list is fair game.
import { TIME_CONTROLS } from "../../timeControls.js";

const QUICK_ADD_PRESETS = TIME_CONTROLS.filter(
  (tc) => tc.baseMinutes === null || tc.baseMinutes >= 1,
);

// Client-side-only bucketing so each row in the plan can wear the same
// bullet/blitz/rapid/classical badge the finished match uses (see
// CATEGORY_LABEL), purely cosmetic, the server assigns the real category
// once a leg actually starts (see api/cageMatches.ts's CageLeg.category).
function legCategory(leg: CageLegPlan): LegCategory {
  if (leg.baseMinutes === null || leg.baseMinutes >= 30) return "classical";
  if (leg.baseMinutes >= 10) return "rapid";
  if (leg.baseMinutes >= 3) return "blitz";
  return "bullet";
}

interface CageGamePlanEditorProps {
  legs: CageLegPlan[];
  onChange: (legs: CageLegPlan[]) => void;
}

/**
 * The "which games, in what order" builder for a cage match. Split out of
 * CreateCageMatch/CageMatches so the quick-add controls and the ordered
 * list can each get enough room to read clearly, this used to be a single
 * cramped row of unlabeled selects plus a dense scrolling list, which is
 * what people were running into trouble with when actually scheduling a
 * match. Every quick-add field now has its own label, the row wraps into a
 * clean 2-column grid on phone instead of overflowing, and each planned
 * game gets a full-width row with a category badge and larger tap targets
 * for reordering/removing.
 */
export function CageGamePlanEditor({
  legs,
  onChange,
}: CageGamePlanEditorProps) {
  const [presetIdx, setPresetIdx] = useState(2);
  const [variant, setVariant] = useState<CageVariant>("standard");
  const [count, setCount] = useState(5);

  function addQuickLegs() {
    const preset = QUICK_ADD_PRESETS[presetIdx];
    const additions: CageLegPlan[] = Array.from(
      { length: Math.max(1, Math.min(30, count)) },
      () => ({
        variant,
        baseMinutes: preset.baseMinutes,
        incrementSeconds: preset.incrementSeconds,
      }),
    );
    onChange([...legs, ...additions]);
  }

  function removeLeg(index: number) {
    onChange(legs.filter((_, i) => i !== index));
  }

  function moveLeg(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= legs.length) return;
    const next = [...legs];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-base-content">
            Games ({legs.length})
            <HelpTip>
              Games are played in this order, one after another. Drag isn't
              needed, use the up/down arrows on a game to reorder it.
            </HelpTip>
          </h3>
        </div>

        {legs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-base-300 px-3 py-4 text-center text-sm text-base-content/50">
            No games yet. Add some below to build the match.
          </p>
        ) : (
          <ol className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {legs.map((leg, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-200 text-xs font-semibold text-base-content/60">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-base-content">
                      {formatLegTimeControl(leg)}
                    </span>
                    <Badge variant="neutral">
                      <span className="inline-flex items-center gap-1">
                        <CategoryIcon category={legCategory(leg)} size={11} />
                        {CATEGORY_LABEL[legCategory(leg)]}
                      </span>
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveLeg(i, -1)}
                    disabled={i === 0}
                    aria-label="Move game up"
                    className="rounded-lg p-2 text-base-content/60 transition-colors hover:bg-base-300 disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLeg(i, 1)}
                    disabled={i === legs.length - 1}
                    aria-label="Move game down"
                    className="rounded-lg p-2 text-base-content/60 transition-colors hover:bg-base-300 disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLeg(i)}
                    aria-label="Remove game"
                    className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-900/20"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-xl border border-base-300 bg-base-100/40 p-3">
        <h4 className="mb-2.5 text-sm font-semibold text-base-content">
          Add games
        </h4>
        <div className="grid gap-3 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
          <Select
            label="Time control"
            value={presetIdx}
            onChange={(e) => setPresetIdx(Number(e.target.value))}
          >
            {QUICK_ADD_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select
            label="Variant"
            value={variant}
            onChange={(e) => setVariant(e.target.value as CageVariant)}
          >
            <option value="standard">Standard</option>
            <option value="chess960">Chess960</option>
          </Select>
          <Input
            label={
              <span className="relative flex">
                Nō
                <HelpTip className="absolute -translate-y-1/2 top-1/2 ml-1">
                  Number of games to be added
                </HelpTip>
              </span>
            }
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <Button size="md" fullWidth className="mt-3" onClick={addQuickLegs}>
          <ListPlus className="h-4 w-4" /> Add to game plan
        </Button>
      </div>
    </div>
  );
}
