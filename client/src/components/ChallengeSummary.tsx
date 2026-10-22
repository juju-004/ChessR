import { Fragment, type ReactNode } from "react";
import { RCoin } from "./ui/RCoin.js";
import { TimeControlIcon } from "./ui/TimeControlIcon.js";

export interface ChallengeClock {
  baseMinutes: number | null;
  incrementSeconds: number;
}

export function clockLabel(tc: ChallengeClock): string {
  if (tc.baseMinutes === null) return "Unlimited";
  const base = tc.baseMinutes === 0.5 ? "½" : String(tc.baseMinutes);
  return `${base}+${tc.incrementSeconds}`;
}

const VARIANT_LABEL: Record<string, string> = {
  standard: "Standard",
  chess960: "Chess960",
  crazyhouse: "Crazyhouse",
};

/** "X challenged you · 20 R · Crazyhouse · 5+3", the one-line description of
 *  a challenge, used by the toast and the notification bell so they always
 *  read the same. Details are separated by dots (no brackets). With odds the
 *  clock part reads "you 3+0, X 5+2". */
export function ChallengeSummary({
  username,
  timeControl,
  odds,
  variant,
  wagerTokens,
  iconSize = 12,
  boldName = false,
}: {
  username: string;
  /** The challenger's clock. */
  timeControl: ChallengeClock;
  /** The challenged player's (the reader's) clock, when it differs. */
  odds?: ChallengeClock | null;
  variant?: string | null;
  wagerTokens?: number | null;
  iconSize?: number;
  boldName?: boolean;
}) {
  const parts: ReactNode[] = [];

  if (wagerTokens) {
    parts.push(
      <span key="wager" className="inline-flex items-center gap-0.5">
        {wagerTokens} <RCoin className="translate-y-0.75" size={iconSize + 2} />
      </span>,
    );
  }
  if (variant) {
    parts.push(<span key="variant">{VARIANT_LABEL[variant] ?? variant}</span>);
  }
  parts.push(
    odds ? (
      <span key="clock" className="inline-flex items-center gap-0.5">
        <TimeControlIcon baseMinutes={Math.min(timeControl.baseMinutes ?? Infinity, odds.baseMinutes ?? Infinity)} size={iconSize} />
        you {clockLabel(odds)}, {username} {clockLabel(timeControl)}
      </span>
    ) : (
      <span key="clock" className="inline-flex items-center gap-0.5">
        <TimeControlIcon baseMinutes={timeControl.baseMinutes} size={iconSize} />
        {clockLabel(timeControl)}
      </span>
    ),
  );

  return (
    <span>
      {boldName ? <span className="font-semibold">{username}</span> : username} challenged you
      {parts.map((part, i) => (
        <Fragment key={i}>
          {" · "}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
