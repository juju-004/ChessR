import { useState } from "react";
import { Gauge, Puzzle, Users } from "lucide-react";
import { RCoin } from "../ui/RCoin.js";
import {
  SettingsGroup,
  SettingsNumber,
  SettingsSelect,
} from "../ui/SettingsFields.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../../lib/limits.js";
import {
  DIFFICULTY_LABEL,
  type PuzzleRaceDifficulty,
} from "../../api/puzzleRaces.js";

export const PUZZLE_COUNT_OPTIONS = [3, 5, 7, 10];
export const MAX_PLAYER_OPTIONS = [2, 3, 4, 6, 8];

/** State + derived wager values for the create-race form (the puzzle-race
 *  counterpart of useGameSettings). */
export function useRaceSettings() {
  const [difficulty, setDifficulty] = useState<PuzzleRaceDifficulty>("mixed");
  const [puzzleCount, setPuzzleCount] = useState(5);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [wagerInput, setWagerInput] = useState("0");

  const wagerTokens = Math.min(
    MAX_WAGER_TOKENS,
    Math.max(0, Math.floor(Number(wagerInput) || 0)),
  );
  const wagerBelowFloor = wagerTokens > 0 && wagerTokens < MIN_STAKE_TOKENS;

  return {
    difficulty,
    setDifficulty,
    puzzleCount,
    setPuzzleCount,
    maxPlayers,
    setMaxPlayers,
    wagerInput,
    setWagerInput,
    wagerTokens,
    wagerBelowFloor,
  };
}

export type RaceSettings = ReturnType<typeof useRaceSettings>;

/** Difficulty + puzzle count + max players + wager. Same layout rules as the
 *  game forms: labelled on desktop, one label-free stack on phone. */
export function RaceSettingsFields({
  settings,
  wagerError,
  wagerHint,
}: {
  settings: RaceSettings;
  wagerError?: string;
  wagerHint?: string;
}) {
  const error = settings.wagerBelowFloor
    ? `Enter 0 for a free race, or at least ${MIN_STAKE_TOKENS} R`
    : wagerError;

  return (
    <SettingsGroup error={error} hint={wagerHint}>
      <SettingsSelect
        label="Difficulty"
        icon={<Gauge className="h-4 w-4" />}
        value={settings.difficulty}
        onChange={(e) =>
          settings.setDifficulty(e.target.value as PuzzleRaceDifficulty)
        }
      >
        {(Object.keys(DIFFICULTY_LABEL) as PuzzleRaceDifficulty[]).map((d) => (
          <option key={d} value={d}>
            {DIFFICULTY_LABEL[d]}
          </option>
        ))}
      </SettingsSelect>
      <SettingsSelect
        label="Puzzles"
        icon={<Puzzle className="h-4 w-4" />}
        value={settings.puzzleCount}
        onChange={(e) => settings.setPuzzleCount(Number(e.target.value))}
      >
        {PUZZLE_COUNT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n} puzzles
          </option>
        ))}
      </SettingsSelect>
      <SettingsSelect
        label="Max players"
        icon={<Users className="h-4 w-4" />}
        value={settings.maxPlayers}
        onChange={(e) => settings.setMaxPlayers(Number(e.target.value))}
      >
        {MAX_PLAYER_OPTIONS.map((n) => (
          <option key={n} value={n}>
            Up to {n} players
          </option>
        ))}
      </SettingsSelect>
      <SettingsNumber
        label={
          <span className="inline-flex items-center gap-1">
            <RCoin size={12} /> Coin wager (optional)
          </span>
        }
        ariaLabel="Coin wager (optional)"
        placeholder="Coin wager (optional)"
        icon={<RCoin size={16} />}
        value={settings.wagerInput}
        onChange={settings.setWagerInput}
        min={0}
        max={MAX_WAGER_TOKENS}
      />
    </SettingsGroup>
  );
}
