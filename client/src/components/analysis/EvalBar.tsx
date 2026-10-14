import { memo } from "react";
import { winPercentWhite, formatEval } from "../../lib/analysis/classify.js";
import type { EvalLine } from "../../lib/analysis/engine.js";

/**
 * Vertical evaluation bar. The light segment is white's share of the win
 * chance and always grows from white's side of the board (bottom when white
 * is at the bottom, top when the board is flipped).
 */
export const EvalBar = memo(function EvalBar({
  line,
  orientation,
  className,
}: {
  line: EvalLine | undefined;
  orientation: "white" | "black";
  className?: string;
}) {
  const whitePct = line ? winPercentWhite(line.cpWhite) : 50;
  // Keep a sliver of each color visible so the bar never looks empty.
  const shown = Math.min(98, Math.max(2, whitePct));
  const whiteOnBottom = orientation === "white";
  const whiteWinning = !line || line.cpWhite >= 0;

  return (
    <div
      className={`relative flex w-5 shrink-0 flex-col overflow-hidden rounded-md bg-[#403d39] sm:w-6 ${className ?? ""}`}
      style={{ flexDirection: whiteOnBottom ? "column-reverse" : "column" }}
      aria-label={`Evaluation ${formatEval(line)}`}
    >
      <div
        className="bg-[#f1f1f1]"
        style={{
          height: `${shown}%`,
          transition: "height 300ms ease-out",
        }}
      />
      <span
        className="absolute left-0 right-0 text-center text-[9px] font-bold leading-none sm:text-[10px]"
        style={{
          // The label rides the end of the bar where the leader's color is.
          [whiteWinning === whiteOnBottom ? "bottom" : "top"]: 3,
          color: whiteWinning ? "#403d39" : "#f1f1f1",
        }}
      >
        {formatEval(line)}
      </span>
    </div>
  );
});
