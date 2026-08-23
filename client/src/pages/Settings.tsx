import {
  useSettings,
  DEFAULT_SETTINGS,
  type BoardTheme,
  type PieceTheme,
} from "../contexts/SettingsContext.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { ChessBoard } from "../components/ChessBoard.js";
import { InstallAppButton } from "../components/InstallAppButton.js";
import { useInstallPrompt } from "../hooks/useInstallPrompt.js";
import { computeDests } from "../chessUtils.js";
import { Chess } from "chess.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Switch,
  Button,
} from "../components/ui/index.js";

const BOARD_THEMES: { value: BoardTheme; label: string; swatch: string }[] = [
  { value: "brown", label: "Brown", swatch: "bg-[#b58863]" },
  { value: "green", label: "Green", swatch: "bg-[#769656]" },
  { value: "blue", label: "Blue", swatch: "bg-[#4b7399]" },
  { value: "gray", label: "Gray", swatch: "bg-[#7a7a7a]" },
  { value: "purple", label: "Purple", swatch: "bg-[#8877b5]" },
];

const PIECE_THEMES: {
  value: PieceTheme;
  label: string;
  description: string;
  available: boolean;
}[] = [
  {
    value: "classic",
    label: "Classic",
    description:
      "A refined, versatile set with a clean and familiar chess aesthetic.",
    available: true,
  },
  {
    value: "mono",
    label: "Monochrome",
    description: "Minimalist silhouettes with a clean, modern visual style.",
    available: true,
  },
  {
    value: "contrast",
    label: "High contrast",
    description: "Bold, defined shapes designed for strong visual clarity.",
    available: true,
  },
  {
    value: "wood",
    label: "Wood",
    description:
      "A classic tournament-inspired set with warm, traditional character.",
    available: true,
  },
];

export function Settings() {
  const { settings, updateSetting, resetSettings } = useSettings();
  const { isInstalled } = useInstallPrompt();
  const confirmDialog = useConfirm();

  const previewChess = new Chess();

  async function handleReset() {
    if (
      await confirmDialog({
        title: "Reset all settings to their defaults?",
        variant: "danger",
        confirmLabel: "Reset",
      })
    ) {
      resetSettings();
    }
  }

  return (
    <Page
      title="Settings"
      actions={
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Reset to defaults
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div className="space-y-4">
          <Card variant="solid">
            <CardHeader>
              <CardTitle>App</CardTitle>
            </CardHeader>
            <CardContent>
              {isInstalled ? (
                <p className="text-sm text-green-500">
                  ✓ Installed. you're already running Chess R standalone.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-base-content/50">
                    Install Chess R on this device for a focused, full-screen
                    experience. Launch it directly from your home screen or app
                    list without browser tabs or an address bar.
                  </p>
                  <InstallAppButton installOnly />
                </>
              )}
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <CardTitle>Board theme</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {BOARD_THEMES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => updateSetting("boardTheme", t.value)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      settings.boardTheme === t.value
                        ? "border-(--primary) bg-(--primary)/10 text-(--primary)"
                        : "border-base-300 bg-base-100 text-base-content/80 hover:border-base-content/30"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-sm ${t.swatch}`}
                    />
                    {t.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <CardTitle>Piece theme</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-base-content/50">
                Explore authentic chess piece sets, each with its own
                distinctive artistic style.
              </p>
              <div className="flex flex-wrap gap-2">
                {PIECE_THEMES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() =>
                      t.available && updateSetting("pieceTheme", t.value)
                    }
                    disabled={!t.available}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      !t.available
                        ? "cursor-not-allowed border-base-300 bg-base-100 text-base-content/30"
                        : settings.pieceTheme === t.value
                          ? "border-(--primary) bg-(--primary)/10 text-(--primary)"
                          : "border-base-300 bg-base-100 text-base-content/80 hover:border-base-content/30"
                    }`}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="text-xs text-base-content/50">
                      {t.description}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <CardTitle>Board & gameplay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Switch
                label="Piece animation"
                description="Animate pieces smoothly when they move. Disable this for instant movement."
                checked={settings.pieceAnimation}
                onChange={(v) => updateSetting("pieceAnimation", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Show board coordinates"
                description="Display file and rank labels along the edges of the board."
                checked={settings.showCoordinates}
                onChange={(v) => updateSetting("showCoordinates", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Show legal moves"
                description="Highlight the legal destination squares for the selected piece."
                checked={settings.showLegalMoves}
                onChange={(v) => updateSetting("showLegalMoves", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Auto-queen"
                description="Automatically promote to a queen. Disable this to choose the promotion piece each time."
                checked={settings.autoQueen}
                onChange={(v) => updateSetting("autoQueen", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Move sounds"
                description="Play a subtle sound for moves, captures, and checks."
                checked={settings.soundEnabled}
                onChange={(v) => updateSetting("soundEnabled", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Confirm resignation"
                description="Ask for confirmation before resigning a game."
                checked={settings.confirmResign}
                onChange={(v) => updateSetting("confirmResign", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />{" "}
              <Switch
                label="Zen mode"
                description="Keep your focus on the board and clock by hiding the move list, chat, and extra badges."
                checked={settings.zenMode}
                onChange={(v) => updateSetting("zenMode", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
            </CardContent>
          </Card>
        </div>

        <Card variant="solid" className="h-fit">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`aspect-square w-full board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme}`}
            >
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
            <p className="mt-2 text-xs text-base-content/50">
              Drag a piece to preview legal-move highlighting and piece
              animations in real time.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-xs text-base-content/40">
        Your preferences are saved on this device only. Defaults:{" "}
        {DEFAULT_SETTINGS.boardTheme} board, animation{" "}
        {DEFAULT_SETTINGS.pieceAnimation ? "on" : "off"}).
      </p>
    </Page>
  );
}
