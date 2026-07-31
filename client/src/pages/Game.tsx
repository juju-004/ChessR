import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Chess } from "chess.js";
import { getGameByCode, joinGame, cancelGame } from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import {
  Swords,
  Flag,
  Handshake,
  Ban,
  Pause,
  Play,
  ShieldAlert,
  MessageSquare,
  Share2,
} from "lucide-react";
import { ChessBoard } from "../components/ChessBoard.js";
import { PromotionPicker } from "../components/PromotionPicker.js";
import {
  PlayerPanelRow,
  PlayerPanelFlank,
  panelMaterial,
} from "../components/PlayerPanels.js";
import { FloatingActionButton } from "../components/FloatingActionButton.js";
import { GameOverModal } from "../components/GameOverModal.js";
import { CageMatchScoreboard } from "../components/CageMatchScoreboard.js";
import { Card, Button, Badge, Spinner } from "../components/ui/index.js";
import { springSnappy } from "../lib/motion.js";
import {
  computeDests,
  needsPromotion,
  isInCheck,
  computePremoveDests,
  addChess960CastlingDests,
  computeMaterialDiff,
  turnColor,
} from "../chessUtils.js";
import { refreshBalance } from "../api/walletStore.js";
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  playGameStartSound,
  playGameOverSound,
  setSoundEnabled,
} from "../sounds.js";
import { copyToClipboard } from "@/lib/utils.js";

interface GameMeta {
  _id: string;
  joinCode: string;
  variant: "standard" | "chess960";
  initialFen: string;
  white: { _id: string; username: string } | null;
  black: { _id: string; username: string } | null;
  status: "waiting" | "active" | "finished" | "aborted";
  wagerTokens?: number;
  cageMatchId?: string | null;
  legIndex?: number | null;
  tournamentId?: string | null;
}

interface MoveLogEntry {
  moveNumber: number;
  san: string;
  from: string;
  to: string;
}

type Role = "white" | "black" | "spectator";

export function Game() {
  const { code = "" } = useParams<{ code: string }>();
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const { notify, dismiss } = useNotify();
  const { settings } = useSettings();
  const confirmDialog = useConfirm();

  useEffect(() => {
    setSoundEnabled(settings.soundEnabled);
  }, [settings.soundEnabled]);

  const [gameMeta, setGameMeta] = useState<GameMeta | null>(null);
  const [mode, setMode] = useState<"loading" | "need-join" | "board">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");

  const [role, setRole] = useState<Role>("spectator");
  const roleRef = useRef<Role>("spectator");
  const [status, setStatus] = useState<
    "waiting" | "active" | "finished" | "aborted"
  >("active");
  const [fen, setFen] = useState(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  );
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [moves, setMoves] = useState<MoveLogEntry[]>([]);
  const [whiteRemainingMs, setWhiteRemainingMs] = useState<number | null>(null);
  const [blackRemainingMs, setBlackRemainingMs] = useState<number | null>(null);
  const [turnStartedAtMs, setTurnStartedAtMs] = useState(Date.now());
  const [gameOver, setGameOver] = useState<{
    result: string | null;
    reason: string;
    wagerSettlement?: {
      wagerTokens: number;
      potTokens: number;
      winnerId: string | null;
    } | null;
  } | null>(null);
  const [whiteConnected, setWhiteConnected] = useState(false);
  const [blackConnected, setBlackConnected] = useState(false);
  const [connStatus, setConnStatus] = useState("Connecting…");
  const [moveError, setMoveError] = useState("");
  const [promoPending, setPromoPending] = useState<{
    orig: string;
    dest: string;
  } | null>(null);
  const [disconnectBanner, setDisconnectBanner] = useState<{
    message: string;
    claimable: boolean;
  } | null>(null);
  const [rematchState, setRematchState] = useState<"idle" | "offered">("idle");
  const [pausedLeg, setPausedLeg] = useState(false);
  const [whiteBerserk, setWhiteBerserk] = useState(false);
  const [blackBerserk, setBlackBerserk] = useState(false);
  const [pauseRequestSent, setPauseRequestSent] = useState(false);
  const [resumeRequestSent, setResumeRequestSent] = useState(false);
  const [gameOverModalDismissed, setGameOverModalDismissed] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    { username: string; message: string; at: number }[]
  >([]);
  const [chatInput, setChatInput] = useState("");
  // Spectator chat lives in a bottom-sheet modal on mobile (there's no
  // room for a persistent chat card next to a board that has to fit the
  // viewport) instead of always-visible inline like on desktop.
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? "http://localhost:5173";

  const chess = useMemo(() => new Chess(fen), [fen]);
  const myColor: "white" | "black" | undefined =
    role === "white" || role === "black" ? role : undefined;

  // PREMOVE LOGIC: these must be memoized, not recomputed inline on every
  // render, AND — just as importantly — declared unconditionally up here
  // rather than further down past the `if (mode === "loading") return (...)`
  // / `if (mode === "need-join") return (...)` early returns below. Hooks
  // called after a conditional return fire a different number of times
  // depending on which branch a given render takes, which is exactly what
  // broke the whole page just now (React bails out with "Rendered more/fewer
  // hooks than during the previous render" the moment `mode` changes).
  //

  const dests = useMemo(() => {
    let d = computeDests(chess);
    if (gameMeta?.variant === "chess960") {
      d = addChess960CastlingDests(d, chess, gameMeta.initialFen);
    }
    return d;
  }, [chess, gameMeta?.variant, gameMeta?.initialFen]);
  const premoveDests = useMemo(
    () =>
      myColor
        ? computePremoveDests(chess, myColor)
        : new Map<string, string[]>(),
    [chess, myColor],
  );

  // Forces a re-render every 100ms while a clock is actually running, so
  // the live "remaining time minus elapsed-since-turn-started" figures
  // below stay ticking smoothly. Declared as a hook up here (unconditional,
  // before the early returns below) for the same reason dests/premoveDests
  // are — see the big comment above them.
  const [, forceClockTick] = useState(0);
  const clockRunning = status === "active" && moves.length >= 2;
  useEffect(() => {
    if (!clockRunning) return;
    const interval = window.setInterval(
      () => forceClockTick((n) => n + 1),
      100,
    );
    return () => window.clearInterval(interval);
  }, [clockRunning]);

  // The board's allotted space can be either width- or height-bound
  // depending on viewport shape (a tall phone vs. a wide desktop window),
  // and CSS aspect-ratio + max-width/max-height alone can't reliably pick
  // "whichever is smaller" and re-derive the other dimension from it — so
  // this measures the actual box the board sits in and sizes it in JS.

  // --- Load game metadata, decide whether to show a "join" gate --------------
  useEffect(() => {
    let cancelled = false;
    setMode("loading");
    setLoadError("");

    getGameByCode(code)
      .then(({ game }) => {
        if (cancelled) return;
        setGameMeta(game);
        const isWhite = game.white?._id === user?.id;
        if (game.status === "waiting" && !isWhite) {
          setMode("need-join");
        } else {
          setMode("board");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiRequestError ? err.message : "Game not found",
        );
        setMode("loading");
      });

    return () => {
      cancelled = true;
    };
  }, [code, user?.id]);

  async function handleJoin() {
    if (!gameMeta) return;
    try {
      await joinGame(gameMeta._id);
      setMode("board");
    } catch (err) {
      setLoadError(
        err instanceof ApiRequestError ? err.message : "Could not join",
      );
    }
  }

  // --- Socket wiring once we're ready to actually show a board ---------------
  useEffect(() => {
    if (mode !== "board" || !socket || !gameMeta) return;
    const gameId = gameMeta._id;
    setConnStatus("Connecting…");

    // Hoisted so it can be cleared from onOpponentReconnected, onOver, and the
    // effect cleanup — not just left to self-terminate. Previously this lived
    // only inside onOpponentDisconnected's closure, which meant reconnecting
    // cleared the *displayed* banner via state but left the interval running,
    // and it would just set the banner right back on its next 500ms tick.
    let disconnectCountdownInterval: number | undefined;
    function clearDisconnectCountdown() {
      if (disconnectCountdownInterval !== undefined) {
        window.clearInterval(disconnectCountdownInterval);
        disconnectCountdownInterval = undefined;
      }
    }

    function deriveLastMove(
      moveList: MoveLogEntry[],
    ): [string, string] | undefined {
      const last = moveList[moveList.length - 1];
      return last ? [last.from, last.to] : undefined;
    }

    function onConnectError(err: Error) {
      setConnStatus((prev) =>
        prev === "Connecting…" ? `Connection failed: ${err.message}` : prev,
      );
    }

    // Room membership does not survive a reconnect — a dropped/restarted
    // connection gets a brand-new server-side socket that isn't in the game
    // room until we explicitly rejoin. Listening on 'connect' (which fires on
    // the *first* connection too) means this is the single source of truth
    // for joining, covering both the initial mount and any later reconnect.
    function joinRoom() {
      if (!socket) return;

      socket.emit("game:join", { gameId });
    }

    function onSync(payload: any) {
      setRole(payload.role);
      roleRef.current = payload.role;
      setStatus(payload.status);
      setFen(payload.fen);
      setMoves(payload.moves ?? []);
      setLastMove(deriveLastMove(payload.moves ?? []));
      setWhiteRemainingMs(payload.whiteRemainingMs);
      setBlackRemainingMs(payload.blackRemainingMs);
      setTurnStartedAtMs(payload.turnStartedAtMs);
      setWhiteConnected(!!payload.whiteConnected);
      setBlackConnected(!!payload.blackConnected);
      setPausedLeg(!!payload.paused);
      setWhiteBerserk(!!payload.berserk?.white);
      setBlackBerserk(!!payload.berserk?.black);
      const gameIsOver =
        payload.status === "finished" || payload.status === "aborted";
      setGameOver(
        gameIsOver
          ? { result: payload.result ?? null, reason: payload.endReason }
          : null,
      );
      if (gameIsOver) setGameOverModalDismissed(false);
      setConnStatus(
        payload.role === "spectator"
          ? "Spectating"
          : payload.status === "active"
            ? "Your game"
            : payload.status === "waiting"
              ? "Waiting for opponent…"
              : payload.status,
      );
    }

    function onMove(payload: any) {
      setFen(payload.fen);
      setLastMove([payload.from, payload.to]);
      setWhiteRemainingMs(payload.whiteRemainingMs);
      setBlackRemainingMs(payload.blackRemainingMs);
      setTurnStartedAtMs(payload.turnStartedAtMs);
      setPausedLeg(false);
      setMoves((prev) => [
        ...prev,
        {
          moveNumber: payload.moveNumber,
          san: payload.san,
          from: payload.from,
          to: payload.to,
        },
      ]);

      const san: string = payload.san ?? "";
      if (san.includes("+") || san.includes("#")) playCheckSound();
      else if (san.includes("x")) playCaptureSound();
      else playMoveSound();
    }

    function onOver(payload: {
      result: string | null;
      reason: string;
      wagerSettlement?: {
        wagerTokens: number;
        potTokens: number;
        winnerId: string | null;
      } | null;
    }) {
      setStatus(payload.reason === "aborted_no_moves" ? "aborted" : "finished");
      setGameOver(payload);
      setGameOverModalDismissed(false);
      clearDisconnectCountdown();
      setDisconnectBanner(null);
      playGameOverSound();

      // A wager payout/refund (or the stake being locked away in the first
      // place) changes the R token balance — refresh the shared store so the
      // navbar badge and dashboard update without needing a reload.
      if (payload.wagerSettlement && payload.wagerSettlement.wagerTokens > 0) {
        refreshBalance().catch(() => {});
      }
    }

    function onError(payload: { message: string }) {
      setMoveError(payload.message);
    }

    function markConnection(userId: string, connected: boolean) {
      if (gameMeta?.white?._id === userId) setWhiteConnected(connected);
      if (gameMeta?.black?._id === userId) setBlackConnected(connected);
    }

    function onOpponentConnected(payload: { userId: string }) {
      setConnStatus((s) =>
        s === "Your game" || s === "active" ? "Opponent connected" : s,
      );
      markConnection(payload.userId, true);
      playGameStartSound();
    }

    function onStateChanged() {
      if (!socket) return;

      socket.emit("game:join", { gameId });
    }

    function onBerserked(payload: {
      side: "white" | "black";
      whiteRemainingMs: number | null;
      blackRemainingMs: number | null;
    }) {
      if (payload.side === "white") setWhiteBerserk(true);
      else setBlackBerserk(true);
      if (payload.whiteRemainingMs !== null)
        setWhiteRemainingMs(payload.whiteRemainingMs);
      if (payload.blackRemainingMs !== null)
        setBlackRemainingMs(payload.blackRemainingMs);
    }

    function onOpponentDisconnected(payload: {
      userId: string;
      graceMs: number;
    }) {
      markConnection(payload.userId, false);
      if (roleRef.current === "spectator") return; // claiming isn't a spectator's call to make

      clearDisconnectCountdown(); // defensive — shouldn't already be one running, but don't stack if so
      const expiresAt = Date.now() + payload.graceMs;
      const tick = () => {
        const remaining = Math.max(0, expiresAt - Date.now());
        setDisconnectBanner({
          message:
            remaining > 0
              ? `Opponent disconnected. You can claim the game in ${Math.ceil(remaining / 1000)}s if they don't return.`
              : "Opponent has not reconnected — you can claim this game now.",
          claimable: remaining <= 0,
        });
        if (remaining <= 0) clearDisconnectCountdown();
      };
      tick();
      disconnectCountdownInterval = window.setInterval(tick, 500);
    }

    function onClaimAvailable() {
      if (roleRef.current === "spectator") return;
      clearDisconnectCountdown();
      setDisconnectBanner({
        message: "Opponent has not reconnected — you can claim this game now.",
        claimable: true,
      });
    }

    function onOpponentReconnected(payload: { userId: string }) {
      markConnection(payload.userId, true);
      clearDisconnectCountdown();
      setDisconnectBanner(null);
    }

    function onDrawOffered() {
      if (roleRef.current === "spectator") return; // not theirs to accept/decline
      if (!socket) return;

      notify("Your opponent offered a draw.", [
        {
          label: "Accept",
          onClick: () =>
            socket.emit("game:respond_draw", { gameId, accept: true }),
        },
        {
          label: "Decline",
          variant: "secondary",
          onClick: () =>
            socket.emit("game:respond_draw", { gameId, accept: false }),
        },
      ]);
    }

    function onChatMessage(payload: {
      username: string;
      message: string;
      at: number;
    }) {
      setChatMessages((prev) => [...prev.slice(-199), payload]);
    }

    function onLegPaused(payload: { gameId: string }) {
      if (payload.gameId !== gameId) return;
      setPausedLeg(true);
      setPauseRequestSent(false);
    }

    function onLegResumed(payload: { gameId: string }) {
      if (payload.gameId !== gameId) return;
      setPausedLeg(false);
      setResumeRequestSent(false);
    }

    function onPauseRequestSent(payload: { matchId: string }) {
      if (payload.matchId !== gameMeta?.cageMatchId) return;
      setPauseRequestSent(true);
    }

    function onPauseDeclinedLocal(payload: { matchId: string }) {
      if (payload.matchId !== gameMeta?.cageMatchId) return;
      setPauseRequestSent(false);
    }

    function onResumeRequestSent(payload: { matchId: string }) {
      if (payload.matchId !== gameMeta?.cageMatchId) return;
      setResumeRequestSent(true);
    }

    function onResumeDeclinedLocal(payload: { matchId: string }) {
      if (payload.matchId !== gameMeta?.cageMatchId) return;
      setResumeRequestSent(false);
    }

    socket.on("connect_error", onConnectError);
    socket.on("connect", joinRoom);
    socket.on("game:sync", onSync);
    socket.on("game:move", onMove);
    socket.on("game:over", onOver);
    socket.on("game:error", onError);
    socket.on("game:opponent_connected", onOpponentConnected);
    socket.on("game:state_changed", onStateChanged);
    socket.on("game:opponent_disconnected", onOpponentDisconnected);
    socket.on("game:claim_available", onClaimAvailable);
    socket.on("game:opponent_reconnected", onOpponentReconnected);
    socket.on("game:draw_offered", onDrawOffered);
    socket.on("game:berserked", onBerserked);
    socket.on("spectator_chat:message", onChatMessage);
    socket.on("cage:leg_paused", onLegPaused);
    socket.on("cage:leg_resumed", onLegResumed);
    socket.on("cage:pause_request_sent", onPauseRequestSent);
    socket.on("cage:pause_declined", onPauseDeclinedLocal);
    socket.on("cage:resume_request_sent", onResumeRequestSent);
    socket.on("cage:resume_declined", onResumeDeclinedLocal);

    // Covers the common case where the socket is already connected by the
    // time this effect runs (normal navigation to the page).
    if (socket.connected) joinRoom();

    return () => {
      clearDisconnectCountdown();
      socket.off("connect_error", onConnectError);
      socket.off("connect", joinRoom);
      socket.off("game:sync", onSync);
      socket.off("game:move", onMove);
      socket.off("game:over", onOver);
      socket.off("game:error", onError);
      socket.off("game:opponent_connected", onOpponentConnected);
      socket.off("game:state_changed", onStateChanged);
      socket.off("game:opponent_disconnected", onOpponentDisconnected);
      socket.off("game:claim_available", onClaimAvailable);
      socket.off("game:opponent_reconnected", onOpponentReconnected);
      socket.off("game:draw_offered", onDrawOffered);
      socket.off("game:berserked", onBerserked);
      socket.off("spectator_chat:message", onChatMessage);
      socket.off("cage:leg_paused", onLegPaused);
      socket.off("cage:leg_resumed", onLegResumed);
      socket.off("cage:pause_request_sent", onPauseRequestSent);
      socket.off("cage:pause_declined", onPauseDeclinedLocal);
      socket.off("cage:resume_request_sent", onResumeRequestSent);
      socket.off("cage:resume_declined", onResumeDeclinedLocal);
    };
  }, [mode, socket, gameMeta, notify]);

  const handleUserMove = useCallback(
    (orig: string, dest: string) => {
      if (!socket || !gameMeta) return;
      setMoveError("");
      const localChess = new Chess(fen);
      if (needsPromotion(localChess, orig, dest)) {
        if (settings.autoQueen) {
          socket.emit("game:move", {
            gameId: gameMeta._id,
            from: orig,
            to: dest,
            promotion: "q",
          });
          return;
        }
        setPromoPending({ orig, dest });
        return;
      }
      socket.emit("game:move", { gameId: gameMeta._id, from: orig, to: dest });
    },
    [socket, gameMeta, fen, settings.autoQueen],
  );

  function handlePromotionPick(piece: "q" | "r" | "b" | "n") {
    if (!promoPending || !socket || !gameMeta) return;
    socket.emit("game:move", {
      gameId: gameMeta._id,
      from: promoPending.orig,
      to: promoPending.dest,
      promotion: piece,
    });
    setPromoPending(null);
  }

  function handleForfeitCageMatch() {
    if (!gameMeta?.cageMatchId || !socket) return;
    if (
      confirm(
        "Forfeit the ENTIRE cage match — not just this leg? Your opponent will be declared the overall winner and any remaining legs will be skipped.",
      )
    ) {
      socket.emit("cage:forfeit", { matchId: gameMeta.cageMatchId });
    }
  }

  function handlePauseRequest() {
    if (!gameMeta?.cageMatchId || !socket) return;
    socket.emit("cage:pause_request", { matchId: gameMeta.cageMatchId });
  }

  function handleResumeRequest() {
    if (!gameMeta?.cageMatchId || !socket) return;
    socket.emit("cage:resume_request", { matchId: gameMeta.cageMatchId });
  }

  async function handleResign() {
    if (!socket || !gameMeta) return;
    if (
      !settings.confirmResign ||
      (await confirmDialog({
        title: "Resign this game?",
        variant: "danger",
        confirmLabel: "Resign",
      }))
    ) {
      socket.emit("game:resign", { gameId: gameMeta._id });
    }
  }

  async function handleAbort() {
    if (!socket || !gameMeta) return;
    const ok = await confirmDialog({
      title: "Abort this game?",
      description: "No result will be recorded for either player.",
      variant: "danger",
      confirmLabel: "Abort",
    });
    if (ok) {
      socket.emit("game:abort", { gameId: gameMeta._id });
    }
  }

  async function handleCancelWaitingGame() {
    if (!gameMeta) return;
    const ok = await confirmDialog({
      title: "Cancel this game?",
      description: gameMeta.wagerTokens
        ? `Your ${gameMeta.wagerTokens} R token stake will be refunded.`
        : "You can create a new one any time.",
      variant: "danger",
      confirmLabel: "Cancel game",
    });
    if (!ok) return;
    try {
      await cancelGame(gameMeta._id);
      navigate("/");
    } catch (err) {
      setLoadError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not cancel the game",
      );
    }
  }

  async function handleBerserk() {
    if (!socket || !gameMeta) return;
    const ok = await confirmDialog({
      title: "Berserk!",
      description:
        "Halve your own clock and give up your increment for a shot at a bonus 0.5 point if you win.",
      confirmLabel: "Berserk",
    });
    if (ok) {
      socket.emit("game:berserk", { gameId: gameMeta._id });
    }
  }

  function handleOfferDraw() {
    if (!socket || !gameMeta) return;
    socket.emit("game:offer_draw", { gameId: gameMeta._id });
  }

  function handleClaim(claim: "win" | "draw") {
    if (!socket || !gameMeta) return;
    socket.emit("game:claim_disconnect", { gameId: gameMeta._id, claim });
  }

  function handleRematch() {
    if (!socket || !gameMeta) return;
    socket.emit("game:rematch_offer", { gameId: gameMeta._id });
    setRematchState("offered");
    notify("Rematch offer sent — waiting for your opponent…", [], 5000);
  }

  const handleShareGame = () => {
    copyToClipboard(`${CLIENT_URL}/game/${code}`);
    const n = notify("Copied game url");
    setTimeout(() => {
      dismiss(n);
    }, 2000);
  };

  function handleSendChat(e: FormEvent) {
    e.preventDefault();
    if (!socket || !gameMeta || !chatInput.trim()) return;
    socket.emit("spectator_chat:send", {
      gameId: gameMeta._id,
      message: chatInput.trim(),
    });
    setChatInput("");
  }

  if (loadError) {
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4">
        <Card
          variant="solid"
          className="border-red-900/50 bg-red-950/20 text-red-300"
        >
          {loadError}
        </Card>
      </div>
    );
  }

  if (mode === "loading") {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  if (mode === "need-join" && gameMeta) {
    return (
      <div className="mx-auto mt-6 max-w-md px-4">
        <Card variant="strong" className="text-center">
          <h1 className="mb-1 text-xl font-bold text-base-content">
            Game{" "}
            <span className="font-normal text-base-content/50">· {code}</span>
          </h1>
          {gameMeta.variant === "chess960" && (
            <Badge variant="secondary" className="mb-2">
              Chess960
            </Badge>
          )}
          <p className="mb-4 text-sm text-base-content/60">
            {gameMeta.white?.username} is waiting for an opponent.
          </p>
          {!!gameMeta.wagerTokens && (
            <Card
              variant="solid"
              className="mb-4 border-amber-900/40 bg-amber-950/20 text-left text-sm text-amber-300"
            >
              This is a wagered game — joining will stake{" "}
              <strong>{gameMeta.wagerTokens} R tokens</strong> from your
              balance. The winner takes the full {gameMeta.wagerTokens * 2}.
            </Card>
          )}
          {loadError && (
            <p className="mb-3 text-sm text-red-400">{loadError}</p>
          )}
          <Button onClick={handleJoin} fullWidth>
            Join this game
          </Button>
        </Card>
      </div>
    );
  }

  const isPlayer = role !== "spectator";
  const inCheck = isInCheck(chess);

  const badges: ReactNode[] = [];
  if (!settings.zenMode) {
    if (gameMeta?.variant === "chess960")
      badges.push(
        <Badge key="960" variant="secondary">
          Chess960
        </Badge>,
      );
    if (gameMeta?.wagerTokens)
      badges.push(
        <Badge key="wager" variant="warning">
          {gameMeta.wagerTokens} R wager
        </Badge>,
      );
    if (gameMeta?.tournamentId)
      badges.push(
        <Link key="tourney" to="/tournaments">
          <Badge variant="glass" className="hover:brightness-110">
            Tournament game
          </Badge>
        </Link>,
      );
    if (whiteBerserk)
      badges.push(
        <Badge key="wb" variant="error">
          ⚔ White berserked
        </Badge>,
      );
    if (blackBerserk)
      badges.push(
        <Badge key="bb" variant="error">
          ⚔ Black berserked
        </Badge>,
      );
  }

  // --- Live clocks + material diff, computed once and handed down to
  // whichever panel presentation (row on desktop, flank on mobile) is
  // actually rendered, so there's exactly one ticking source of truth. ---
  const sideToMove = turnColor(chess);
  const clockKnown = whiteRemainingMs !== null && blackRemainingMs !== null;
  const elapsedMs = clockRunning ? Date.now() - turnStartedAtMs : 0;
  const liveWhiteMs =
    clockKnown && sideToMove === "white"
      ? (whiteRemainingMs as number) - elapsedMs
      : whiteRemainingMs;
  const liveBlackMs =
    clockKnown && sideToMove === "black"
      ? (blackRemainingMs as number) - elapsedMs
      : blackRemainingMs;
  const material = computeMaterialDiff(fen);
  const whiteMaterial = panelMaterial("white", material);
  const blackMaterial = panelMaterial("black", material);
  const isActiveGame = status === "active";

  const whitePanelData = {
    username: gameMeta?.white?.username ?? "White",
    isTurn: isActiveGame && sideToMove === "white",
    connected: whiteConnected,
    liveMs: liveWhiteMs,
    clockKnown,
    ...whiteMaterial,
  };
  const blackPanelData = {
    username: gameMeta?.black?.username ?? "Black",
    isTurn: isActiveGame && sideToMove === "black",
    connected: blackConnected,
    liveMs: liveBlackMs,
    clockKnown,
    ...blackMaterial,
  };
  // The panel matching my seat renders closest to me — bottom on desktop,
  // right-hand flank on mobile; the opponent's is the mirror of that.
  const myPanelData = myColor === "black" ? blackPanelData : whitePanelData;
  const opponentPanelData =
    myColor === "black" ? whitePanelData : blackPanelData;

  const showChat = !settings.zenMode && role === "spectator";

  const moveListEntries =
    moves.length === 0 ? null : (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm text-base-content/80 sm:grid-cols-3 md:grid-cols-2">
        {moves.map((m) => (
          <div key={m.moveNumber}>
            <span className="text-base-content/40">{m.moveNumber}.</span>{" "}
            {m.san}
          </div>
        ))}
      </div>
    );

  const chatBody = (
    <>
      <div className="mb-2 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl bg-base-100/60 p-2.5 text-sm">
        {chatMessages.length === 0 && (
          <p className="text-base-content/50">No messages yet.</p>
        )}
        {chatMessages.map((m, i) => (
          <p key={i}>
            <span className="font-semibold text-(--primary)">
              {m.username}:
            </span>{" "}
            <span className="text-base-content">{m.message}</span>
          </p>
        ))}
      </div>
      <form onSubmit={handleSendChat} className="flex shrink-0 gap-2">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          maxLength={300}
          placeholder="Say something…"
          className="h-10 flex-1 rounded-lg border border-base-300 bg-base-100/60 px-3 text-sm text-base-content backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-(--primary)"
        />
        <Button type="submit" size="md">
          Send
        </Button>
      </form>
    </>
  );

  return (
    <div className="mx-auto flex h-[calc(100vh)]  max-w-6xl flex-col gap-2 px-4 pb-2 sm:px-0 md:h-[calc(100dvh-7rem)] md:gap-3">
      {/* Header — code, badges, connection status. Always visible, never
       *  scrolls with the rest of the page. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-base-content">
            Game{" "}
            <span className="font-normal text-base-content/40">· {code}</span>
          </h1>
          <motion.button
            type="button"
            onClick={handleShareGame}
            whileTap={{ scale: 0.9 }}
            transition={springSnappy}
            className={
              "glass relative flex h-9 w-9 items-center justify-center rounded-full text-base-content/80 hover:text-base-content"
            }
          >
            <Share2 className="size-4" />
          </motion.button>
          {badges}
        </div>
        <span className="flex items-center gap-1.5 text-xs font-medium text-base-content/60">
          {!gameOver && (
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
          {gameOver
            ? `Game over — ${describeResult(gameOver.result)} (${gameOver.reason.replace(/_/g, " ")})`
            : connStatus}
        </span>
      </div>

      {/* Banners — cage scoreboard, pause state, disconnects, the waiting-
       *  for-opponent notice, extra tournament/cage actions. All shrink-0
       *  (they add height when present rather than eating into the fixed
       *  board/panels area below). */}
      <div className="shrink-0 space-y-2">
        {!settings.zenMode && gameMeta?.cageMatchId && (
          <CageMatchScoreboard
            cageMatchId={gameMeta.cageMatchId}
            legIndex={gameMeta.legIndex ?? 0}
          />
        )}

        {pausedLeg && !gameOver && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-800/40 bg-amber-950/20 p-2.5 text-center text-sm text-amber-300">
            <Pause className="h-4 w-4" /> This leg is paused
            {isPlayer ? "" : " by the players"}.
          </div>
        )}

        {disconnectBanner && (
          <Card variant="solid" className="border-red-900/50 bg-red-950/20">
            <p className="mb-2 flex items-center gap-1.5 text-sm text-red-300">
              <ShieldAlert className="h-4 w-4 shrink-0" />{" "}
              {disconnectBanner.message}
            </p>
            {disconnectBanner.claimable && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleClaim("win")}
                >
                  Claim victory
                </Button>
                <Button
                  size="sm"
                  variant="glass"
                  onClick={() => handleClaim("draw")}
                >
                  Claim draw
                </Button>
              </div>
            )}
          </Card>
        )}

        {isPlayer && status === "waiting" && (
          <div className="flex items-center gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5">
            <p className="flex-1 text-sm text-base-content/60">
              Waiting for an opponent to join…
            </p>
            <Button variant="glass" size="sm" onClick={handleCancelWaitingGame}>
              <Ban className="h-4 w-4" /> Cancel game
            </Button>
          </div>
        )}

        {moveError && (
          <p className="text-center text-sm text-red-400">{moveError}</p>
        )}

        {isPlayer &&
          status === "active" &&
          gameMeta?.tournamentId &&
          myColor &&
          !(myColor === "white" ? whiteBerserk : blackBerserk) &&
          (myColor === "white" ? moves.length === 0 : moves.length <= 1) && (
            <Button
              size="sm"
              onClick={handleBerserk}
              className="border border-red-800 bg-red-950/30 text-red-300 shadow-none hover:bg-red-950/50 hover:brightness-100"
            >
              <Swords className="h-4 w-4" /> Berserk — halve your clock for a
              bonus point
            </Button>
          )}

        {isPlayer &&
          gameMeta?.cageMatchId &&
          status === "active" &&
          moves.length < 2 &&
          !pausedLeg && (
            <Button
              size="sm"
              disabled={pauseRequestSent}
              onClick={handlePauseRequest}
              className="border border-amber-800 bg-amber-950/30 text-amber-300 shadow-none hover:bg-amber-950/50 hover:brightness-100"
            >
              <Pause className="h-4 w-4" />
              {pauseRequestSent ? "Pause request sent…" : "Request pause"}
            </Button>
          )}

        {isPlayer && gameMeta?.cageMatchId && pausedLeg && (
          <Card
            variant="solid"
            className="border-amber-800/40 bg-amber-950/20 text-sm text-amber-300"
          >
            <p className="mb-2 flex items-center gap-1.5 font-semibold">
              <Pause className="h-4 w-4" /> This leg is paused.
            </p>
            <Button
              size="sm"
              disabled={resumeRequestSent}
              onClick={handleResumeRequest}
              className="bg-amber-700 text-white shadow-none hover:bg-amber-600 hover:brightness-100"
            >
              <Play className="h-4 w-4" />
              {resumeRequestSent ? "Resume request sent…" : "Request resume"}
            </Button>
          </Card>
        )}

        {isPlayer && gameMeta?.cageMatchId && (
          <Button
            size="sm"
            onClick={handleForfeitCageMatch}
            className="border border-red-900 bg-red-950/30 text-red-300 shadow-none hover:bg-red-950/50 hover:brightness-100"
          >
            Forfeit entire cage match
          </Button>
        )}
      </div>

      {/* Main content: move list (left, desktop) / board (center) / panels
       *  + chat (right, desktop). On mobile this collapses to a single
       *  column — move-list bubble on top, board with panels flanking it,
       *  chat moved into a bottom-sheet instead. */}
      <div className=" bg-red-500 min-h-0 flex-1  gap-2 flex flex-col justify-center items-start md:gap-3">
        {/* Move list — desktop: tall card in the left column. */}
        {/* {!settings.zenMode && (
          <Card variant="solid" className="hidden min-h-0 flex-col md:flex">
            <h2 className="mb-2 shrink-0 text-base font-semibold text-base-content">
              Moves
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {moveListEntries ?? (
                <p className="text-sm text-base-content/50">No moves yet.</p>
              )}
            </div>
          </Card>
        )} */}

        {/* Move list — mobile: full-width scrollable bubble at the top. */}
        {/* {!settings.zenMode && (
          <Card variant="solid" className="flex max-h-28 shrink-0 flex-col md:hidden">
            <h2 className="mb-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-base-content/50">
              Moves
            </h2>
            <div className="min-h-0 overflow-y-auto">
              {moveListEntries ?? <p className="text-sm text-base-content/50">No moves yet.</p>}
            </div>
          </Card>
        )} */}

        {/* Board, flanked by the player panels on mobile only. The middle
         *  wrapper (ref'd for measurement) always stretches to fill its
         *  cell — the mobile flex row's remaining width, or the desktop
         *  grid column — so boardSize above reflects genuinely available
         *  space either way. */}
        <div className="flex w-7xl bg-blue-700 flex-1 p-3.5 items-center justify-center gap-2 md:contents">
          <PlayerPanelFlank {...opponentPanelData} className="md:hidden" />

          <div
            className={`relative w-full aspect-square flex-1 shrink-0 overflow-hidden rounded-2xl shadow-lg board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme}`}
          >
            <ChessBoard
              fen={fen}
              orientation={myColor ?? "white"}
              viewOnly={!isPlayer || status !== "active" || pausedLeg}
              turnColor={chess.turn() === "w" ? "white" : "black"}
              movableColor={myColor}
              dests={dests}
              premoveDests={premoveDests}
              inCheck={inCheck}
              lastMove={lastMove}
              onUserMove={handleUserMove}
              animationEnabled={settings.pieceAnimation}
              showCoordinates={settings.showCoordinates}
              showLegalMoves={settings.showLegalMoves}
            />
            {promoPending && <PromotionPicker onPick={handlePromotionPick} />}
          </div>

          <PlayerPanelFlank {...myPanelData} className="md:hidden" />
        </div>

        {/* Player panels + spectator chat — desktop only, right column. */}
        <div className="hidden min-h-0 flex-col gap-3 md:flex">
          <Card variant="solid" className="shrink-0 space-y-2">
            <PlayerPanelRow {...opponentPanelData} />
            <PlayerPanelRow {...myPanelData} />
          </Card>

          {showChat && (
            <Card variant="solid" className="flex min-h-0 flex-1 flex-col">
              <h2 className="mb-1 flex shrink-0 items-center gap-1.5 text-base font-semibold text-base-content">
                <MessageSquare className="h-4 w-4" /> Spectator chat
              </h2>
              <p className="mb-2 shrink-0 text-xs text-base-content/50">
                Only visible to spectators, not the players. Not saved —
                refreshing clears it.
              </p>
              {chatBody}
            </Card>
          )}
        </div>
      </div>

      {/* Floating action bubbles — offer draw / abort / resign (and, on
       *  mobile, the spectator-chat trigger). Fixed to the viewport rather
       *  than living in the page flow, per the "end of the page" spot on
       *  every device; sits above the mobile bottom dock. */}
      <div
        className="fixed inset-x-0 z-30 flex justify-center gap-2 md:bottom-6"
        style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}
      >
        {isPlayer &&
          status === "active" &&
          (moves.length < 2 ? (
            <FloatingActionButton
              icon={Ban}
              label="Abort"
              onClick={handleAbort}
            />
          ) : (
            <>
              <FloatingActionButton
                icon={Handshake}
                label="Draw"
                onClick={handleOfferDraw}
              />
              <FloatingActionButton
                icon={Flag}
                label="Resign"
                onClick={handleResign}
                variant="danger"
              />
            </>
          ))}
        {showChat && (
          <FloatingActionButton
            icon={MessageSquare}
            label="Chat"
            onClick={() => setChatSheetOpen(true)}
            className="md:hidden"
          />
        )}
      </div>

      {/* Spectator chat — mobile bottom sheet. */}
      <AnimatePresence>
        {showChat && chatSheetOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setChatSheetOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="glass-strong absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl p-4"
              style={{
                paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
              }}
              onClick={(e) => e.stopPropagation()}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={springSnappy}
            >
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-base-content">
                  <MessageSquare className="h-4 w-4" /> Spectator chat
                </h2>
                <button
                  onClick={() => setChatSheetOpen(false)}
                  aria-label="Close"
                  className="text-base-content/50 hover:text-base-content/80"
                >
                  ✕
                </button>
              </div>
              <p className="mb-2 shrink-0 text-xs text-base-content/50">
                Only visible to spectators, not the players. Not saved —
                refreshing clears it.
              </p>
              {chatBody}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {gameOver && !gameOverModalDismissed && (
        <GameOverModal
          result={gameOver.result}
          reason={gameOver.reason}
          myColor={myColor}
          isPlayer={isPlayer}
          canRematch={
            isPlayer &&
            gameOver.reason !== "aborted_no_moves" &&
            gameOver.reason !== "cage_forfeit"
          }
          rematchState={rematchState}
          wagerSettlement={gameOver.wagerSettlement}
          myUserId={user?.id}
          onRematch={handleRematch}
          onClose={() => setGameOverModalDismissed(true)}
        />
      )}
    </div>
  );
}

function describeResult(result: string | null): string {
  if (result === "white") return "White wins";
  if (result === "black") return "Black wins";
  if (result === "draw") return "Draw";
  return "Game aborted";
}
