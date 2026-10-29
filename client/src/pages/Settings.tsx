import { useMemo, useState } from "react";
import {
  useSettings,
  DEFAULT_SETTINGS,
  type PieceTheme,
} from "../contexts/SettingsContext.js";
import { BOARD_THEMES } from "../lib/boardThemes.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { updateMyProfile } from "../api/users.js";
import { updateAuthUser } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { ChessBoard } from "../components/ChessBoard.js";
import { InstallAppButton } from "../components/InstallAppButton.js";
import { useInstallPrompt } from "../hooks/useInstallPrompt.js";
import { computeDests } from "../chessUtils.js";
import { Chess } from "chess.js";
import { isVibrationSupported } from "../haptics.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Switch,
  Button,
} from "../components/ui/index.js";

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
  const { user } = useAuth();
  const { notify } = useNotify();
  // This one, unlike everything in useSettings() above, is account-level
  // (persisted server-side on the User doc, enforced server-side too, see
  // challengeSocket.ts's challenge:send handler), not a per-device
  // localStorage preference, so it's tracked and saved separately: local
  // state for a snappy toggle plus an in-flight PATCH, rather than
  // updateSetting's fire-and-forget localStorage write.
  const [acceptChallenges, setAcceptChallenges] = useState(
    user?.acceptChallenges ?? true,
  );
  const [savingAcceptChallenges, setSavingAcceptChallenges] = useState(false);

  async function handleAcceptChallengesChange(value: boolean) {
    setAcceptChallenges(value);
    setSavingAcceptChallenges(true);
    try {
      await updateMyProfile({ acceptChallenges: value });
      updateAuthUser({ acceptChallenges: value });
    } catch (err) {
      setAcceptChallenges(!value);
      notify(
        err instanceof ApiRequestError
          ? err.message
          : "Couldn't save that change",
        [],
        4000,
      );
    } finally {
      setSavingAcceptChallenges(false);
    }
  }

  const previewChess = useMemo(() => new Chess(), []);
  const previewDests = useMemo(() => computeDests(previewChess), [previewChess]);

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
      <div className="settings-grid">
        <Card variant="solid" className="settings-grid-app">
          <CardHeader>
            <CardTitle>App</CardTitle>
          </CardHeader>
          <CardContent>
            {isInstalled ? (
              <p className="text-sm text-green-500">
                ✓ Installed. you're already running Chessr standalone.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-base-content/50">
                  Install Chessr on this device for a focused, full-screen
                  experience. Launch it directly from your home screen or app
                  list without browser tabs or an address bar.
                </p>
                <InstallAppButton />
              </>
            )}
          </CardContent>
        </Card>

        <div className="settings-grid-rest space-y-4">
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Board Theme</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Just the colours: each swatch is a tiny 2x2 board in the theme's
                  light and dark squares. Names are kept for screen readers only. */}
              <div
                role="radiogroup"
                aria-label="Board theme"
                className="grid grid-cols-5 justify-items-center gap-3 sm:grid-cols-7 lg:grid-cols-10"
              >
                {BOARD_THEMES.map((t) => {
                  const selected = settings.boardTheme === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={t.value}
                      onClick={() => updateSetting("boardTheme", t.value)}
                      className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary) ${
                        selected
                          ? "ring-2 ring-(--primary) ring-offset-2 ring-offset-base-100"
                          : "ring-1 ring-base-content/15 hover:scale-105"
                      }`}
                    >
                      <span className="grid h-full w-full grid-cols-2 grid-rows-2" aria-hidden="true">
                        <span style={{ backgroundColor: t.light }} />
                        <span style={{ backgroundColor: t.dark }} />
                        <span style={{ backgroundColor: t.dark }} />
                        <span style={{ backgroundColor: t.light }} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <CardTitle>Piece Theme</CardTitle>
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
              <CardTitle>Board & Gameplay</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Switch
                label="Piece Animation"
                description="Animate pieces smoothly when they move. Disable this for instant movement."
                checked={settings.pieceAnimation}
                onChange={(v) => updateSetting("pieceAnimation", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Show Board Coordinates"
                description="Display file and rank labels along the edges of the board."
                checked={settings.showCoordinates}
                onChange={(v) => updateSetting("showCoordinates", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Show Legal Moves"
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
                label="Move Sounds"
                description="Play a subtle sound for moves, captures, and checks."
                checked={settings.soundEnabled}
                onChange={(v) => updateSetting("soundEnabled", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Vibration"
                description={
                  isVibrationSupported()
                    ? "Buzz your phone on a check, a capture, or when your clock runs low."
                    : "Not supported by this browser or device (iPhones don't allow web apps to vibrate)."
                }
                checked={settings.vibration && isVibrationSupported()}
                onChange={(v) => updateSetting("vibration", v)}
                disabled={!isVibrationSupported()}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
              <Switch
                label="Confirm Resignation"
                description="Ask for confirmation before resigning a game."
                checked={settings.confirmResign}
                onChange={(v) => updateSetting("confirmResign", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />{" "}
              <Switch
                label="Zen Mode"
                description="Keep your focus on the board and clock by hiding the move list, chat, and extra badges."
                checked={settings.zenMode}
                onChange={(v) => updateSetting("zenMode", v)}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
            </CardContent>
          </Card>

          <Card variant="solid">
            <CardHeader>
              <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Switch
                label="Accept Challenges"
                description="Let other players send you direct challenges or cage match invites. Turn this off and both are rejected automatically, tournaments are unaffected."
                checked={acceptChallenges}
                onChange={handleAcceptChallengesChange}
                disabled={savingAcceptChallenges}
                className="rounded-lg px-1 py-2 hover:bg-base-100"
              />
            </CardContent>
          </Card>
        </div>

        <Card variant="solid" className="settings-grid-preview">
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
                dests={previewDests}
                onUserMove={() => {}}
                animationEnabled={settings.pieceAnimation}
                showCoordinates={settings.showCoordinates}
                showLegalMoves={settings.showLegalMoves}
                forceInsideCoordinates
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
        Board and gameplay preferences are saved on this device only. Defaults:{" "}
        {DEFAULT_SETTINGS.boardTheme} board, animation{" "}
        {DEFAULT_SETTINGS.pieceAnimation ? "on" : "off"}. "Accept challenges" is
        saved to your account and applies everywhere you're signed in.
      </p>
    </Page>
  );
}
