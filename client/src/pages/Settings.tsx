import { useSettings, DEFAULT_SETTINGS, type BoardTheme, type PieceTheme } from '../contexts/SettingsContext.js';
import { ChessBoard } from '../components/ChessBoard.js';
import { InstallAppButton } from '../components/InstallAppButton.js';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';
import { computeDests } from '../chessUtils.js';
import { Chess } from 'chess.js';

const BOARD_THEMES: { value: BoardTheme; label: string; swatch: string }[] = [
  { value: 'brown', label: 'Brown', swatch: 'bg-[#b58863]' },
  { value: 'green', label: 'Green', swatch: 'bg-[#769656]' },
  { value: 'blue', label: 'Blue', swatch: 'bg-[#4b7399]' },
  { value: 'gray', label: 'Gray', swatch: 'bg-[#7a7a7a]' },
  { value: 'purple', label: 'Purple', swatch: 'bg-[#8877b5]' },
];

const PIECE_THEMES: { value: PieceTheme; label: string; description: string }[] = [
  { value: 'classic', label: 'Classic', description: 'The default cburnett set, untouched.' },
  { value: 'mono', label: 'Monochrome', description: 'Grayscale, high-contrast silhouettes.' },
  { value: 'contrast', label: 'High contrast', description: 'Punchier colors and edges.' },
  { value: 'wood', label: 'Wood', description: 'A warm, sepia-toned finish.' },
];

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 hover:border-neutral-700">
      <div>
        <div className="text-sm text-neutral-200">{label}</div>
        {description && <div className="text-xs text-neutral-500">{description}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-amber-600"
      />
    </label>
  );
}

export function Settings() {
  const { settings, updateSetting, resetSettings } = useSettings();
  const { isInstalled } = useInstallPrompt();

  const previewChess = new Chess();

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-100">Settings</h1>
        <button
          onClick={() => confirm('Reset all settings to their defaults?') && resetSettings()}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          Reset to defaults
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-2 text-sm font-semibold text-neutral-200">App</h2>
            {isInstalled ? (
              <p className="text-sm text-green-400">✓ Installed — you're already running Chess App standalone.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-neutral-500">
                  Install Chess App on this device for a full-screen, standalone experience — no browser tabs or
                  address bar, launches from your home screen/app list like any other app.
                </p>
                <InstallAppButton />
              </>
            )}
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">Board theme</h2>
            <div className="flex flex-wrap gap-2">
              {BOARD_THEMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => updateSetting('boardTheme', t.value)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    settings.boardTheme === t.value
                      ? 'border-amber-700 bg-amber-900/20 text-amber-200'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-sm ${t.swatch}`} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">Piece theme</h2>
            <div className="flex flex-wrap gap-2">
              {PIECE_THEMES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => updateSetting('pieceTheme', t.value)}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${
                    settings.pieceTheme === t.value
                      ? 'border-amber-700 bg-amber-900/20 text-amber-200'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-neutral-500">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">Board & gameplay</h2>
            <div className="space-y-2">
              <ToggleRow
                label="Piece animation"
                description="Animate pieces sliding into place. Turn off for instant snaps."
                checked={settings.pieceAnimation}
                onChange={(v) => updateSetting('pieceAnimation', v)}
              />
              <ToggleRow
                label="Show board coordinates"
                description="File/rank labels around the edge of the board."
                checked={settings.showCoordinates}
                onChange={(v) => updateSetting('showCoordinates', v)}
              />
              <ToggleRow
                label="Show legal moves"
                description="Highlight the destination squares a selected piece can move to."
                checked={settings.showLegalMoves}
                onChange={(v) => updateSetting('showLegalMoves', v)}
              />
              <ToggleRow
                label="Auto-queen"
                description="Automatically promote to a queen without asking — untick to choose the piece every time."
                checked={settings.autoQueen}
                onChange={(v) => updateSetting('autoQueen', v)}
              />
              <ToggleRow
                label="Move sounds"
                description="A short sound on moves, captures, and checks."
                checked={settings.soundEnabled}
                onChange={(v) => updateSetting('soundEnabled', v)}
              />
              <ToggleRow
                label="Confirm resignation"
                description="Ask 'are you sure?' before resigning a game."
                checked={settings.confirmResign}
                onChange={(v) => updateSetting('confirmResign', v)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-3 text-sm font-semibold text-neutral-200">Zen mode</h2>
            <ToggleRow
              label="Zen mode"
              description="Hides move list, chat, and extra badges during a game — just the board and clock."
              checked={settings.zenMode}
              onChange={(v) => updateSetting('zenMode', v)}
            />
          </div>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">Preview</h2>
          <div className={`aspect-square w-full board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme}`}>
            <ChessBoard
              fen={previewChess.fen()}
              orientation="white"
              viewOnly={false}
              turnColor="white"
              movableColor="white"
              dests={computeDests(previewChess)}
              onUserMove={() => {}}
              animationEnabled={settings.pieceAnimation}
              showCoordinates={settings.showCoordinates}
              showLegalMoves={settings.showLegalMoves}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Try dragging a piece to see legal-move highlighting and animation settings live.
          </p>
        </div>
      </div>

      <p className="text-xs text-neutral-600">
        These preferences are saved on this device only (defaults: {DEFAULT_SETTINGS.boardTheme} board,
        animation {DEFAULT_SETTINGS.pieceAnimation ? 'on' : 'off'}).
      </p>
    </div>
  );
}
