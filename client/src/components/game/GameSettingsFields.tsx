import { useState } from "react";
import { Clock, Shuffle } from "lucide-react";
import { RCoin } from "../ui/RCoin.js";
import {
  SettingsGroup,
  SettingsNumber,
  SettingsSelect,
} from "../ui/SettingsFields.js";
import { TIME_CONTROLS } from "../../timeControls.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../../lib/limits.js";
import type { GameVariant } from "../../api/games.js";

/** State + derived values behind the create-game / challenge forms, so each
 *  page doesn't re-declare the same tcIndex/variant/wager trio and the same
 *  wager clamping. */
export function useGameSettings(initialTcIndex = 2) {
  const [tcIndex, setTcIndex] = useState(initialTcIndex);
  const [variant, setVariant] = useState<GameVariant>("standard");
  const [wagerInput, setWagerInput] = useState("0");

  // Wagers are opt-in: 0 = a free game. The clamp only clears out
  // negative/garbage input.
  const wagerTokens = Math.min(
    MAX_WAGER_TOKENS,
    Math.max(0, Math.floor(Number(wagerInput) || 0)),
  );
  const wagerBelowFloor = wagerTokens > 0 && wagerTokens < MIN_STAKE_TOKENS;

  return {
    tcIndex,
    setTcIndex,
    variant,
    setVariant,
    wagerInput,
    setWagerInput,
    timeControl: TIME_CONTROLS[tcIndex],
    wagerTokens,
    wagerBelowFloor,
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
}

const WAGER_LABEL = (
  <span className="inline-flex items-center gap-1">
    <RCoin size={12} /> Coin wager
  </span>
);

/** Time control + variant + wager, the fields every "create a game" /
 *  "challenge a player" overlay needs. Layout (labelled on desktop, one
 *  label-free stack on phone) comes from SettingsGroup. */
export function GameSettingsFields({
  settings,
  wagerError,
  wagerHint,
}: GameSettingsFieldsProps) {
  const {
    tcIndex,
    setTcIndex,
    variant,
    setVariant,
    wagerInput,
    setWagerInput,
    wagerBelowFloor,
  } = settings;

  const error = wagerBelowFloor
    ? `Enter 0 for a free game, or at least ${MIN_STAKE_TOKENS} R`
    : wagerError;

  return (
    <SettingsGroup error={error} hint={wagerHint}>
      <SettingsSelect
        label="Time control"
        icon={<Clock className="h-4 w-4" />}
        value={tcIndex}
        onChange={(e) => setTcIndex(Number(e.target.value))}
      >
        {TIME_CONTROLS.map((tc, i) => (
          <option key={tc.label} value={i}>
            {tc.label}
          </option>
        ))}
      </SettingsSelect>
      <SettingsSelect
        label="Variant"
        icon={<Shuffle className="h-4 w-4" />}
        value={variant}
        onChange={(e) => setVariant(e.target.value as GameVariant)}
      >
        <option value="standard">Standard</option>
        <option value="chess960">Chess960</option>
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
  );
}
