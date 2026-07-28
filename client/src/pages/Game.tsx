import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useParams, Link } from "react-router-dom";
import { Chess } from "chess.js";
import { getGameByCode, joinGame } from "../api/games.js";
import { ApiRequestError } from "../api/http.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { ChessBoard } from "../components/ChessBoard.js";
import { PromotionPicker } from "../components/PromotionPicker.js";
import { ClockDisplay } from "../components/ClockDisplay.js";
import { GameOverModal } from "../components/GameOverModal.js";
import { CageMatchScoreboard } from "../components/CageMatchScoreboard.js";
import {
  computeDests,
  needsPromotion,
  isInCheck,
  computePremoveDests,
  addChess960CastlingDests,
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
  const { notify } = useNotify();
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
  // Separately from that crash: `chess` itself is already useMemo'd on
  // `fen`, but a plain `computeDests(chess)` call in the render body still
  // allocates a brand new Map every single render — including renders
  // triggered by something totally unrelated to the game (chat input
  // keystrokes, a connection status blip, etc). Since dests/premoveDests
  // are reference-unstable, ChessBoard's reactive useLayoutEffect (which
  // depends on them) re-fires on every one of those renders too, calling
  // `.set({ fen, ... })` again with whatever `fen` this component currently
  // holds.
  //
  // That's the real cause of premoves appearing to take a network
  // round-trip to "stick": the moment a premove becomes legal, chessground
  // executes it internally (via playPremove) and visually moves the piece
  // right away — but our own `fen` state doesn't update until the server
  // echoes OUR move back (handleUserMove only emits over the socket, it
  // never applies the move locally). Any incidental re-render in that
  // window called `.set({ fen: <the pre-premove fen> })` again, which
  // resets chessground back to the old position — undoing the premove's
  // own visual move — until the round-trip finally lands and `fen` catches
  // up. It wasn't slow; it was being told to un-happen and redo itself.
  // Memoizing on `fen` (the only thing these actually depend on) stops that.
  const dests = useMemo(() => {
    let d = computeDests(chess);
    if (gameMeta?.variant === "chess960") {
      d = addChess960CastlingDests(d, chess, gameMeta.initialFen);
    }
    return d;
  }, [chess, gameMeta?.variant, gameMeta?.initialFen]);
  const premoveDests = useMemo(
    () => (myColor ? computePremoveDests(chess, myColor) : new Map<string, string[]>()),
    [chess, myColor],
  );

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
      if (payload.whiteRemainingMs !== null) setWhiteRemainingMs(payload.whiteRemainingMs);
      if (payload.blackRemainingMs !== null) setBlackRemainingMs(payload.blackRemainingMs);
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
          socket.emit("game:move", { gameId: gameMeta._id, from: orig, to: dest, promotion: "q" });
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
      (await confirmDialog({ title: "Resign this game?", variant: "danger", confirmLabel: "Resign" }))
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

  async function handleBerserk() {
    if (!socket || !gameMeta) return;
    const ok = await confirmDialog({
      title: "Berserk!",
      description: "Halve your own clock and give up your increment for a shot at a bonus 0.5 point if you win.",
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
      <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-red-900 bg-red-950/40 p-5 text-red-400">
        {loadError}
      </div>
    );
  }

  if (mode === "loading") {
    return (
      <div className="mx-auto mt-6 max-w-2xl text-neutral-400">Loading…</div>
    );
  }

  if (mode === "need-join" && gameMeta) {
    return (
      <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-2 text-xl font-bold text-neutral-100">
          Game <span className="font-normal text-neutral-500">· {code}</span>
          {gameMeta.variant === "chess960" && (
            <span className="ml-2 rounded bg-purple-900 px-2 py-0.5 text-xs font-semibold text-purple-200">
              Chess960
            </span>
          )}
        </h1>
        <p className="mb-3 text-sm text-neutral-400">
          {gameMeta.white?.username} is waiting for an opponent.
        </p>
        {!!gameMeta.wagerTokens && (
          <p className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-sm text-amber-300">
            This is a wagered game — joining will stake <strong>{gameMeta.wagerTokens} R tokens</strong> from
            your balance. The winner takes the full {gameMeta.wagerTokens * 2}.
          </p>
        )}
        {loadError && <p className="mb-3 text-sm text-red-400">{loadError}</p>}
        <button
          onClick={handleJoin}
          className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
        >
          Join this game
        </button>
      </div>
    );
  }

  const isPlayer = role !== "spectator";
  const inCheck = isInCheck(chess);

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-neutral-100">
            Game <span className="font-normal text-neutral-500">· {code}</span>
            {!settings.zenMode && gameMeta?.variant === "chess960" && (
              <span className="ml-2 rounded bg-purple-900 px-2 py-0.5 text-xs font-semibold text-purple-200">
                Chess960
              </span>
            )}
            {!settings.zenMode && !!gameMeta?.wagerTokens && (
              <span className="ml-2 rounded bg-amber-900/40 px-2 py-0.5 text-xs font-semibold text-amber-300">
                {gameMeta.wagerTokens} R wager
              </span>
            )}
            {!settings.zenMode && gameMeta?.tournamentId && (
              <Link
                to={`/tournaments`}
                className="ml-2 rounded bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-700"
              >
                Tournament game
              </Link>
            )}
            {!settings.zenMode && whiteBerserk && <span className="ml-2 text-xs text-red-400">⚔ White berserked</span>}
            {!settings.zenMode && blackBerserk && <span className="ml-2 text-xs text-red-400">⚔ Black berserked</span>}
          </h1>
          <span className="text-sm text-neutral-400">
            {gameOver
              ? `Game over — ${describeResult(gameOver.result)} (${gameOver.reason.replace(/_/g, " ")})`
              : connStatus}
          </span>
        </div>

        {!settings.zenMode && gameMeta?.cageMatchId && (
          <CageMatchScoreboard cageMatchId={gameMeta.cageMatchId} legIndex={gameMeta.legIndex ?? 0} />
        )}

        {pausedLeg && !gameOver && (
          <div className="mb-3 rounded-md border border-amber-800 bg-amber-950/30 p-3 text-center text-sm text-amber-300">
            ⏸ This leg is paused{isPlayer ? "" : " by the players"}.
          </div>
        )}

        {disconnectBanner && (
          <div className="mb-3 rounded-md border border-red-900 bg-red-950/40 p-3">
            <p className="mb-2 text-sm text-red-300">
              {disconnectBanner.message}
            </p>
            {disconnectBanner.claimable && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleClaim("win")}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
                >
                  Claim victory
                </button>
                <button
                  onClick={() => handleClaim("draw")}
                  className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
                >
                  Claim draw
                </button>
              </div>
            )}
          </div>
        )}

        <ClockDisplay
          fen={fen}
          whiteRemainingMs={whiteRemainingMs}
          blackRemainingMs={blackRemainingMs}
          turnStartedAtMs={turnStartedAtMs}
          isActive={status === "active"}
          movesPlayed={moves.length}
          whiteUsername={gameMeta?.white?.username}
          blackUsername={gameMeta?.black?.username}
          whiteConnected={whiteConnected}
          blackConnected={blackConnected}
        />

        <div
          className={`relative mx-auto aspect-square w-full max-w-[480px] board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme}`}
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

        {moveError && <p className="mt-2 text-sm text-red-400">{moveError}</p>}

        {isPlayer && status === "active" && (
          <div className="mt-3 flex gap-2">
            {moves.length < 2 ? (
              <button
                onClick={handleAbort}
                className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
              >
                Abort game
              </button>
            ) : (
              <>
                <button
                  onClick={handleOfferDraw}
                  className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
                >
                  Offer draw
                </button>
                <button
                  onClick={handleResign}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
                >
                  Resign
                </button>
              </>
            )}
          </div>
        )}

        {isPlayer &&
          status === "active" &&
          gameMeta?.tournamentId &&
          myColor &&
          !(myColor === "white" ? whiteBerserk : blackBerserk) &&
          (myColor === "white" ? moves.length === 0 : moves.length <= 1) && (
            <div className="mt-2">
              <button
                onClick={handleBerserk}
                className="rounded-md border border-red-800 bg-red-950/30 px-4 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/50"
              >
                ⚔ Berserk — halve your clock for a bonus point
              </button>
            </div>
          )}

        {isPlayer && gameMeta?.cageMatchId && status === "active" && moves.length < 2 && !pausedLeg && (
          <div className="mt-2">
            <button
              onClick={handlePauseRequest}
              disabled={pauseRequestSent}
              className="rounded-md border border-amber-800 bg-amber-950/30 px-4 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-950/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pauseRequestSent ? "Pause request sent…" : "⏸ Request pause"}
            </button>
          </div>
        )}

        {isPlayer && gameMeta?.cageMatchId && pausedLeg && (
          <div className="mt-2 rounded-md border border-amber-800 bg-amber-950/30 px-4 py-2 text-sm text-amber-300">
            <p className="mb-2 font-semibold">⏸ This leg is paused.</p>
            <button
              onClick={handleResumeRequest}
              disabled={resumeRequestSent}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resumeRequestSent ? "Resume request sent…" : "▶ Request resume"}
            </button>
          </div>
        )}

        {isPlayer && gameMeta?.cageMatchId && (
          <div className="mt-2">
            <button
              onClick={handleForfeitCageMatch}
              className="rounded-md border border-red-900 bg-red-950/30 px-4 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950/50"
            >
              Forfeit entire cage match
            </button>
          </div>
        )}
      </div>

      {!settings.zenMode && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-2 text-lg font-semibold text-neutral-100">Moves</h2>
          <div className="max-h-48 overflow-y-auto font-mono text-sm text-neutral-300">
            {moves.map((m) => (
              <div key={m.moveNumber}>
                {m.moveNumber}. {m.san}
              </div>
            ))}
          </div>
        </div>
      )}

      {!settings.zenMode && role === "spectator" && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-2 text-lg font-semibold text-neutral-100">
            Spectator chat
          </h2>
          <p className="mb-2 text-xs text-neutral-500">
            Only visible to spectators, not the players. Not saved — refreshing
            clears it.
          </p>
          <div className="mb-2 max-h-48 space-y-1 overflow-y-auto rounded-md bg-neutral-950 p-2 text-sm">
            {chatMessages.length === 0 && (
              <p className="text-neutral-500">No messages yet.</p>
            )}
            {chatMessages.map((m, i) => (
              <p key={i}>
                <span className="font-semibold text-blue-400">
                  {m.username}:
                </span>{" "}
                <span className="text-neutral-200">{m.message}</span>
              </p>
            ))}
          </div>
          <form onSubmit={handleSendChat} className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              maxLength={300}
              placeholder="Say something…"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100"
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {gameOver && !gameOverModalDismissed && (
        <GameOverModal
          result={gameOver.result}
          reason={gameOver.reason}
          myColor={myColor}
          isPlayer={isPlayer}
          canRematch={isPlayer && gameOver.reason !== "aborted_no_moves" && gameOver.reason !== "cage_forfeit"}
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
