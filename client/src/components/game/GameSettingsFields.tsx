import { useState } from "react";
import { Clock, Scale, Shuffle, Timer } from "lucide-react";
import { RCoin } from "../ui/RCoin.js";
import {
  SettingsGroup,
  SettingsNumber,
  SettingsSelect,
} from "../ui/SettingsFields.js";
import { TIME_CONTROLS, type TimeControlOption } from "../../timeControls.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../../lib/limits.js";
import type { GameVariant } from "../../api/games.js";

/** Index of the extra "Custom" entry, one past the last preset. Only the
 *  challenge form offers it; every other form never lands on it. */
export const CUSTOM_TC_INDEX = TIME_CONTROLS.length;
/** Limits for a custom clock (the server checks the same). */
const CUSTOM_MIN_MINUTES = 0.5;
const CUSTOM_MAX_MINUTES = 180;
const CUSTOM_MAX_INCREMENT = 60;
/** Preset used for the opponent's clock when odds are switched on. */
const DEFAULT_ODDS_INDEX = 5; // Blitz 5+0
const UNLIMITED_INDEX = TIME_CONTROLS.findIndex((tc) => tc.baseMinutes === null);

/** One clock: a preset, or (when allowed) a custom base + increment. */
function useClock(initialIndex: number) {
  const [index, setIndex] = useState(initialIndex);
  const [customMinutes, setCustomMinutes] = useState("5");
  const [customIncrement, setCustomIncrement] = useState("0");

  const isCustom = index === CUSTOM_TC_INDEX;
  const minutes = Number(customMinutes);
  const increment = Number(customIncrement);
  const customValid =
    Number.isFinite(minutes) &&
    minutes >= CUSTOM_MIN_MINUTES &&
    minutes <= CUSTOM_MAX_MINUTES &&
    Number.isFinite(increment) &&
    increment >= 0 &&
    increment <= CUSTOM_MAX_INCREMENT;

  const clock: TimeControlOption = isCustom
    ? {
        label: "Custom",
        // Halves of a minute are the finest step offered.
        baseMinutes: customValid ? Math.round(minutes * 2) / 2 : CUSTOM_MIN_MINUTES,
        incrementSeconds: customValid ? Math.round(increment) : 0,
      }
    : TIME_CONTROLS[index];

  return {
    index,
    setIndex,
    customMinutes,
    setCustomMinutes,
    customIncrement,
    setCustomIncrement,
    isCustom,
    /** False only for a custom clock whose numbers are out of range. */
    valid: !isCustom || customValid,
    clock,
  };
}

/** State + derived values behind the create-game / challenge forms, so each
 *  page doesn't re-declare the same tcIndex/variant/wager trio and the same
 *  wager clamping. The custom-clock and odds parts only matter to the
 *  challenge form (GameSettingsFields' `challenge` prop). */
export function useGameSettings(initialTcIndex = 2) {
  const mine = useClock(initialTcIndex);
  const theirs = useClock(DEFAULT_ODDS_INDEX);
  const [oddsOn, setOddsOnRaw] = useState(false);
  const [variant, setVariant] = useState<GameVariant>("standard");
  const [wagerInput, setWagerInput] = useState("0");

  // Wagers are opt-in: 0 = a free game. The clamp only clears out
  // negative/garbage input.
  const wagerTokens = Math.min(
    MAX_WAGER_TOKENS,
    Math.max(0, Math.floor(Number(wagerInput) || 0)),
  );
  const wagerBelowFloor = wagerTokens > 0 && wagerTokens < MIN_STAKE_TOKENS;

  function setOddsOn(on: boolean) {
    // Odds need a timed clock on both sides, so Unlimited can't stay selected.
    if (on && mine.index === UNLIMITED_INDEX) mine.setIndex(DEFAULT_ODDS_INDEX);
    setOddsOnRaw(on);
  }

  return {
    tcIndex: mine.index,
    setTcIndex: mine.setIndex,
    variant,
    setVariant,
    wagerInput,
    setWagerInput,
    timeControl: mine.clock,
    wagerTokens,
    wagerBelowFloor,
    // --- challenge-only extras ---
    mine,
    theirs,
    oddsOn,
    setOddsOn,
    /** The opponent's clock when odds are on, otherwise null. */
    odds: oddsOn ? theirs.clock : null,
    /** A custom clock is selected with out-of-range numbers. */
    clockInvalid: !mine.valid || (oddsOn && !theirs.valid),
  };
}

export type GameSettings = ReturnType<typeof useGameSettings>;

export interface GameSettingsFieldsProps {
  settings: GameSettings;
  /** Extra validation message (e.g. "Not enough R Coins"). The shared
   *  "0 or at least N R" floor message is added automatically. */
  wagerError?: string;
  /** Small helper text under the wager field (e.g. "Winner takes 190"). */
  wagerHint?: string;
  /** The challenge form: adds a Custom time control and the Odds option
   *  (each player on their own clock). Everywhere else keeps the presets. */
  challenge?: boolean;
}

const WAGER_LABEL = (
  <span className="inline-flex items-center gap-1">
    <RCoin size={12} /> Coin wager
  </span>
);

/** The preset list (Unlimited left out when `timed` is required), plus the
 *  Custom entry for challenges. */
function ClockOptions({ timedOnly, custom }: { timedOnly: boolean; custom: boolean }) {
  return (
    <>
      {TIME_CONTROLS.map((tc, i) =>
        timedOnly && tc.baseMinutes === null ? null : (
          <option key={tc.label} value={i}>
            {tc.label}
          </option>
        ),
      )}
      {custom && <option value={CUSTOM_TC_INDEX}>Custom…</option>}
    </>
  );
}

/** Minutes + increment boxes for a custom clock. */
function CustomClockInputs({ clock }: { clock: ReturnType<typeof useClock> }) {
  return (
    <>
      <SettingsNumber
        label="Minutes"
        ariaLabel="Custom minutes"
        placeholder="Minutes (0.5 to 180)"
        icon={<Timer className="h-4 w-4" />}
        value={clock.customMinutes}
        onChange={clock.setCustomMinutes}
        min={CUSTOM_MIN_MINUTES}
        max={CUSTOM_MAX_MINUTES}
        step={0.5}
        noNote
      />
      <SettingsNumber
        label="Increment (seconds)"
        ariaLabel="Custom increment in seconds"
        placeholder="Increment in seconds (0 to 60)"
        icon={<Timer className="h-4 w-4" />}
        value={clock.customIncrement}
        onChange={clock.setCustomIncrement}
        min={0}
        max={CUSTOM_MAX_INCREMENT}
        noNote
      />
    </>
  );
}

/** Time control + variant + wager, the fields every "create a game" /
 *  "challenge a player" overlay needs. Layout (labelled on desktop, one
 *  label-free stack on phone) comes from SettingsGroup. */
export function GameSettingsFields({
  settings,
  wagerError,
  wagerHint,
  challenge = false,
}: GameSettingsFieldsProps) {
  const {
    tcIndex,
    setTcIndex,
    variant,
    setVariant,
    wagerInput,
    setWagerInput,
    wagerBelowFloor,
    mine,
    theirs,
    oddsOn,
    setOddsOn,
  } = settings;

  const error = wagerBelowFloor
    ? `Enter 0 for a free game, or at least ${MIN_STAKE_TOKENS} R`
    : wagerError;

  const showOdds = challenge && oddsOn;

  return (
    <>
      <SettingsGroup error={error} hint={wagerHint}>
        <SettingsSelect
          label={showOdds ? "Your clock" : "Time control"}
          icon={<Clock className="h-4 w-4" />}
          value={tcIndex}
          onChange={(e) => setTcIndex(Number(e.target.value))}
        >
          <ClockOptions timedOnly={showOdds} custom={challenge} />
        </SettingsSelect>
        {challenge && mine.isCustom && <CustomClockInputs clock={mine} />}

        {challenge && (
          <SettingsSelect
            label="Odds"
            icon={<Scale className="h-4 w-4" />}
            value={oddsOn ? "on" : "off"}
            onChange={(e) => setOddsOn(e.target.value === "on")}
          >
            <option value="off">Odds off · same clock</option>
            <option value="on">Odds on · different clocks</option>
          </SettingsSelect>
        )}
        {showOdds && (
          <SettingsSelect
            label="Opponent's clock"
            icon={<Clock className="h-4 w-4" />}
            value={theirs.index}
            onChange={(e) => theirs.setIndex(Number(e.target.value))}
          >
            <ClockOptions timedOnly custom />
          </SettingsSelect>
        )}
        {showOdds && theirs.isCustom && <CustomClockInputs clock={theirs} />}

        <SettingsSelect
          label="Variant"
          icon={<Shuffle className="h-4 w-4" />}
          value={variant}
          onChange={(e) => setVariant(e.target.value as GameVariant)}
        >
          <option value="standard">Standard</option>
          <option value="chess960">Chess960</option>
          <option value="crazyhouse">Crazyhouse</option>
        </SettingsSelect>
        <SettingsNumber
          label={WAGER_LABEL}
          ariaLabel="Coin wager"
          placeholder="Coin wager"
          icon={<RCoin size={16} />}
          value={wagerInput}
          onChange={setWagerInput}
          min={0}
          max={MAX_WAGER_TOKENS}
        />
      </SettingsGroup>
      {challenge && settings.clockInvalid && (
        <p className="text-xs text-red-500">
          Custom clocks: {CUSTOM_MIN_MINUTES} to {CUSTOM_MAX_MINUTES} minutes, and 0 to{" "}
          {CUSTOM_MAX_INCREMENT} seconds of increment.
        </p>
      )}
      {showOdds && (
        <p className="text-xs text-base-content/50">
          Each player plays on their own clock.
        </p>
      )}
    </>
  );
}
