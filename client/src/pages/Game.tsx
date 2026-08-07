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
  MessageSquare,
  Share2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  FlipVertical2,
  MoreHorizontal,
} from "lucide-react";
import { ChessBoard } from "../components/ChessBoard.js";
import { MoveList, MoveStrip } from "../components/MoveLog.js";
import { DisconnectBanner } from "../components/DisconnectBanner.js";
import { PromotionPicker } from "../components/PromotionPicker.js";
import { PlayerPanelRow, panelMaterial } from "../components/PlayerPanels.js";
import { GameOverModal } from "../components/GameOverModal.js";
import { CageMatchScoreboard } from "../components/CageMatchScoreboard.js";
import {
  Card,
  Button,
  Badge,
  Spinner,
  Tooltip,
  Dropdown,
} from "../components/ui/index.js";
import { springSnappy } from "../lib/motion.js";
import {
  computeDests,
  needsPromotion,
  isInCheck,
  computePremoveDests,
  addChess960CastlingDests,
  computeMaterialDiff,
  computeLowTimeThresholdMs,
  turnColor,
} from "../chessUtils.js";
import { refreshBalance } from "../api/walletStore.js";
import {
  playMoveSound,
  playCaptureSound,
  playCheckSound,
  playGameStartSound,
  playGameOverSound,
  playLowTimeSound,
  setSoundEnabled,
} from "../sounds.js";
import { copyToClipboard } from "@/lib/utils.js";

interface GameMeta {
  _id: string;
  joinCode: string;
  variant: "standard" | "chess960";
  initialFen: string;
  white: { _id: string; username: string; avatarGradient?: any } | null;
  black: { _id: string; username: string; avatarGradient?: any } | null;
  status: "waiting" | "active" | "finished" | "aborted";
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
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

/** A game is only ever "live" — i.e. worth opening a socket room for —
 *  while it's waiting for an opponent or actually being played. Once it's
 *  finished or aborted there's nothing left to sync in real time, so
 *  those two statuses are the "stale" side of the fixed /game/:code URL:
 *  same page, same layout, just filled in from the one-shot REST payload
 *  instead of a socket connection. See the fetch effect below. */
function isLiveStatus(status: GameMeta["status"]) {
  return status === "waiting" || status === "active";
}

/** Picks the same check/capture/plain-move sound for a SAN string
 *  regardless of where the move came from — a live game:move event or
 *  just walking the move list during replay. Shared so the two call
 *  sites can't quietly drift apart. */
function playSoundForMove(san: string | undefined) {
  if (!san) return;
  if (san.includes("+") || san.includes("#")) playCheckSound();
  else if (san.includes("x")) playCaptureSound();
  else playMoveSound();
}

/** Press-and-hold auto-repeat for the prev/next move buttons — a single
 *  tap fires `callback` once via onClick as normal; holding past an
 *  initial pause starts firing it again on a timer that shortens each
 *  rep (380ms → floor of 60ms), i.e. it accelerates the longer it's held,
 *  the same feel as a held arrow key. A ref carries the latest `callback`
 *  into the running timer so it keeps calling the freshest version even
 *  though `callback` (handlePrevMove/handleNextMove) closes over state
 *  that changes on every single rep. */
function useHoldRepeat(callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timeoutRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  const stop = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    heldRef.current = false;
    let delay = 380;
    const tick = () => {
      heldRef.current = true;
      callbackRef.current();
      delay = Math.max(60, delay * 0.78);
      timeoutRef.current = window.setTimeout(tick, delay);
    };
    timeoutRef.current = window.setTimeout(tick, delay);
  }, []);

  useEffect(() => stop, [stop]);

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => {
      // A plain tap/click fires this before the 380ms repeat threshold, so
      // heldRef is still false — handle it as a single, normal move. If we
      // *did* end up repeating, the button's already been driven forward
      // by the timer, so the click that follows release would otherwise
      // double up as one extra, unwanted step.
      if (heldRef.current) {
        heldRef.current = false;
        return;
      }
      callbackRef.current();
    },
  };
}

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
  // Mirrors gameMeta for the socket-wiring effect below, which needs to
  // read a couple of gameMeta's fields (player ids, cageMatchId) inside
  // long-lived socket callbacks without taking a dependency on the
  // `gameMeta` object itself — that object gets a new reference on every
  // game:sync (its white/black usernames get refreshed there), and the
  // socket effect tearing itself down and reconnecting on every sync is
  // exactly the "toggling between Connecting… and Waiting for opponent…"
  // loop this avoids.
  const gameMetaRef = useRef<GameMeta | null>(null);
  useEffect(() => {
    gameMetaRef.current = gameMeta;
  }, [gameMeta]);
  const [mode, setMode] = useState<"loading" | "need-join" | "board">(
    "loading",
  );
  const [loadError, setLoadError] = useState("");
  // Set once, from the initial REST fetch below, and never flipped back —
  // a game that's live when this page loads stays on the socket-driven
  // path for the rest of the session even if it finishes while open (the
  // existing game:over handling already covers that). Only a *fresh* load
  // of an already-finished game takes the stale path.
  const [live, setLive] = useState(true);

  const [role, setRole] = useState<Role>("spectator");
  const roleRef = useRef<Role>("spectator");
  // `game:over` and `cage:match_over` can arrive in either order when the
  // final leg of a cage match finishes (see onCageMatchOverOnThisLeg below)
  // — this makes the "skip the per-leg modal" decision order-independent.
  const cageMatchOverRef = useRef(false);
  const moveListScrollRef = useRef<HTMLDivElement | null>(null);
  const moveStripScrollRef = useRef<HTMLDivElement | null>(null);
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
  // Just the expiry timestamp — DisconnectBanner (a separate component)
  // derives the countdown text/claimable state itself and owns its own
  // 500ms tick, so this state only ever changes on actual socket events,
  // never on a timer. See DisconnectBanner.tsx for why that matters.
  const [disconnectExpiresAt, setDisconnectExpiresAt] = useState<number | null>(
    null,
  );
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
  // Board flip is purely a local viewing preference — it doesn't touch
  // `myColor`/server state at all, just which edge of the board the local
  // player's pieces render on.
  const [boardFlipped, setBoardFlipped] = useState(false);
  // Move browsing: null means "tracking the live position" (the normal
  // state). A number is the ply being viewed (0 = starting position, 1 =
  // after white's 1st move, etc). Prev/Next walk this back and forth;
  // Next snaps back to `null` once it reaches the live ply so newly
  // arriving moves resume being followed automatically.
  const [viewPly, setViewPly] = useState<number | null>(null);
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

  // Prev/Next move browsing replays the move list from the game's actual
  // starting position (important for Chess960, where that isn't the
  // standard start) rather than trying to derive positions from `fen`
  // (the live position), which would be the wrong direction to walk
  // backwards from. `chess` above is deliberately left alone — dests/
  // premoveDests/turnColor everywhere else must keep reflecting the real,
  // live position even while the board is visually showing history.
  // Incrementally extended, not fully replayed from scratch, on every move.
  // A naive `useMemo` keyed on [initialFen, moves] still re-runs the whole
  // replay any time the `moves` array gets a new reference — which is every
  // single move, since onMove does `setMoves(prev => [...prev, entry])| —
  // so a full from-scratch replay was chess.js-validating every move of the
  // game over again on top of the one move that just landed. That's exactly
  // the wrong moment to spend extra main-thread time: it's the same render
  // where the board needs to update for the player who just moved. Since
  // `moves` is appended immutably (the prefix keeps the same object
  // references), the cache below can detect "just one new move got
  // appended" via cheap reference equality and only replay that one move
  // against the last cached fen — falling back to a full replay only when
  // the prefix doesn't match (resync, rematch, a shorter/different moves
  // array) or the variant's initial position changed.
  const historyCacheRef = useRef<{
    initialFen: string | undefined;
    moves: MoveLogEntry[];
    fens: string[];
  } | null>(null);
  const historyFens = useMemo(() => {
    try {
      const cache = historyCacheRef.current;
      const canExtend =
        !!cache &&
        cache.initialFen === gameMeta?.initialFen &&
        moves.length >= cache.moves.length &&
        cache.moves.every((m, i) => moves[i] === m);

      const replay = new Chess(
        canExtend ? cache!.fens[cache!.fens.length - 1] : gameMeta?.initialFen,
      );
      const fens = canExtend ? [...cache!.fens] : [replay.fen()];
      const startIndex = canExtend ? cache!.moves.length : 0;
      for (let i = startIndex; i < moves.length; i++) {
        replay.move(moves[i].san);
        fens.push(replay.fen());
      }

      historyCacheRef.current = {
        initialFen: gameMeta?.initialFen,
        moves,
        fens,
      };
      return fens;
    } catch {
      // Shouldn't happen — the move list came from the server — but a
      // broken replay should degrade to "always show the live position"
      // rather than crash the page.
      historyCacheRef.current = null;
      return null;
    }
  }, [gameMeta?.initialFen, moves]);

  const liveViewPly = moves.length;
  const isViewingHistory =
    viewPly !== null && viewPly < liveViewPly && historyFens !== null;
  const displayFen =
    isViewingHistory && historyFens ? historyFens[viewPly!] : fen;
  const displayLastMove = isViewingHistory
    ? viewPly! > 0
      ? ([moves[viewPly! - 1].from, moves[viewPly! - 1].to] as [string, string])
      : undefined
    : lastMove;

  const clockRunning = status === "active" && moves.length >= 2;

  // Scaled to the time control (see computeLowTimeThresholdMs) — a flat
  // "10 seconds left" doesn't mean the same thing in bullet vs. classical.
  const lowTimeThresholdMs = useMemo(
    () => computeLowTimeThresholdMs(gameMeta?.timeControl.baseSeconds ?? null),
    [gameMeta?.timeControl.baseSeconds],
  );

  // --- Live clocks + material diff, computed once and handed down to
  // whichever panel presentation (row on desktop, flank on mobile) is
  // actually rendered, so there's exactly one ticking source of truth. ---
  // NOTE: this whole block — through opponentPanelData below — deliberately
  // lives up here with the other unconditional hooks (dests/premoveDests/
  // historyFens above) rather than down near where it's actually rendered.
  // It contains useMemo calls, and there are three early `return`s for
  // loadError/mode==="loading"/mode==="need-join" between here and there —
  // hooks placed after those fire a different number of times depending on
  // which branch a given render takes, which is exactly the
  // "Rendered more hooks than during the previous render" crash. Same
  // reasoning as the comment on dests/premoveDests above.
  const sideToMove = turnColor(chess);
  const clockKnown = whiteRemainingMs !== null && blackRemainingMs !== null;
  // Memoized on `fen` alone: computeMaterialDiff/panelMaterial build fresh
  // objects each call, which would otherwise hand whitePanelData/
  // blackPanelData's own useMemo below a "changed" dependency on every
  // render regardless of whether the position actually moved, defeating it.
  const material = useMemo(() => computeMaterialDiff(fen), [fen]);
  const whiteMaterial = useMemo(
    () => panelMaterial("white", material),
    [material],
  );
  const blackMaterial = useMemo(
    () => panelMaterial("black", material),
    [material],
  );
  const isActiveGame = status === "active";

  // Memoized: PlayerPanelRow/PlayerPanelFlank are React.memo'd, but a plain
  // object literal here would be a brand-new reference on every render of
  // Game (which re-renders often — chat input, move errors, banners…),
  // defeating that memo every single time regardless of whether any of
  // these values actually changed. useMemo keeps the reference stable
  // across renders where none of the listed dependencies moved.
  const whitePanelData = useMemo(
    () => ({
      username: gameMeta?.white?.username ?? "White",
      avatarGradient: gameMeta?.white?.avatarGradient,
      isTurn: isActiveGame && sideToMove === "white",
      connected: whiteConnected,
      baseRemainingMs: whiteRemainingMs,
      turnStartedAtMs,
      isTicking: clockRunning && sideToMove === "white",
      clockKnown,
      lowTimeThresholdMs,
      ...whiteMaterial,
    }),
    [
      gameMeta?.white?.username,
      gameMeta?.white?.avatarGradient,
      isActiveGame,
      sideToMove,
      whiteConnected,
      whiteRemainingMs,
      turnStartedAtMs,
      clockRunning,
      clockKnown,
      lowTimeThresholdMs,
      whiteMaterial,
    ],
  );
  const blackPanelData = useMemo(
    () => ({
      username: gameMeta?.black?.username ?? "Black",
      avatarGradient: gameMeta?.black?.avatarGradient,
      isTurn: isActiveGame && sideToMove === "black",
      connected: blackConnected,
      baseRemainingMs: blackRemainingMs,
      turnStartedAtMs,
      isTicking: clockRunning && sideToMove === "black",
      clockKnown,
      lowTimeThresholdMs,
      ...blackMaterial,
    }),
    [
      gameMeta?.black?.username,
      gameMeta?.black?.avatarGradient,
      isActiveGame,
      sideToMove,
      blackConnected,
      blackRemainingMs,
      turnStartedAtMs,
      clockRunning,
      clockKnown,
      lowTimeThresholdMs,
      blackMaterial,
    ],
  );
  // The panel matching my seat renders closest to me — bottom on desktop,
  // right-hand flank on mobile; the opponent's is the mirror of that.
  const myPanelData = myColor === "black" ? blackPanelData : whitePanelData;
  const opponentPanelData =
    myColor === "black" ? whitePanelData : blackPanelData;

  // Fires the low-time sound once the moment MY clock first drops under
  // the threshold, then rearms if it climbs back above it (e.g. an
  // increment) so a second low-time stretch can warn again.
  //
  // This runs its own 100ms `setInterval` rather than depending on a
  // shared page-level "tick" state — it only ever calls playLowTimeSound()
  // as a side effect, never setState, so it can't cascade into a re-render
  // of the whole page the way the old `clockTick` state used to (that was
  // the actual cause of animation jank on low-end devices: the whole Game
  // page re-rendering 10x/sec while any clock was running).
  const lowTimeWarnedRef = useRef(false);
  useEffect(() => {
    if (!clockRunning || !myColor || lowTimeThresholdMs <= 0) return;

    function check() {
      const remainingMs =
        myColor === "white" ? whiteRemainingMs : blackRemainingMs;
      if (remainingMs === null) return;
      const isMyTurn = turnColor(chess) === myColor;
      const liveMs = isMyTurn
        ? remainingMs - (Date.now() - turnStartedAtMs)
        : remainingMs;
      if (liveMs > 0 && liveMs <= lowTimeThresholdMs) {
        if (!lowTimeWarnedRef.current) {
          lowTimeWarnedRef.current = true;
          playLowTimeSound();
        }
      } else if (liveMs > lowTimeThresholdMs) {
        lowTimeWarnedRef.current = false;
      }
    }

    check();
    const interval = window.setInterval(check, 100);
    return () => window.clearInterval(interval);
  }, [
    clockRunning,
    myColor,
    whiteRemainingMs,
    blackRemainingMs,
    turnStartedAtMs,
    lowTimeThresholdMs,
    chess,
  ]);

  // Smooth-scrolls the move list/strip to the newest move whenever one is
  // added — but only while live (not while someone's browsing back through
  // history via Prev/click, which would otherwise get yanked away from
  // whatever position they're looking at).
  useEffect(() => {
    if (viewPly !== null) return;
    const list = moveListScrollRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    const strip = moveStripScrollRef.current;
    if (strip) strip.scrollTo({ left: strip.scrollWidth, behavior: "smooth" });
  }, [moves.length, viewPly]);

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
    setViewPly(null);
    setBoardFlipped(false);

    getGameByCode(code)
      .then(({ game }) => {
        if (cancelled) return;
        setGameMeta(game);
        const isWhite = game.white?._id === user?.id;
        const isBlack = game.black?._id === user?.id;

        if (game.status === "waiting" && !isWhite) {
          setMode("need-join");
          setLive(true);
          return;
        }
        setMode("board");

        if (isLiveStatus(game.status)) {
          // Ongoing (or waiting-for-opponent, viewed by its creator) —
          // the socket-wiring effect below takes it from here, same as
          // it always has.
          setLive(true);
          return;
        }

        // Finished/aborted: a stale, one-shot render. No socket room is
        // ever joined for it — everything the board/panels/move list
        // need is filled in here, once, from the REST payload, the same
        // fields a live game:sync would have set.
        setLive(false);
        const movesList: MoveLogEntry[] = game.moves ?? [];
        setStatus(game.status);
        setMoves(movesList);
        const lastEntry = movesList[movesList.length - 1];
        setLastMove(lastEntry ? [lastEntry.from, lastEntry.to] : undefined);
        let finalFen: string = game.fen;
        if (!finalFen) {
          try {
            const replay = new Chess(game.initialFen);
            for (const m of movesList) replay.move(m.san);
            finalFen = replay.fen();
          } catch {
            finalFen = game.initialFen;
          }
        }
        setFen(finalFen);
        setWhiteRemainingMs(game.whiteRemainingMs ?? null);
        setBlackRemainingMs(game.blackRemainingMs ?? null);
        setTurnStartedAtMs(Date.now());
        setWhiteConnected(false);
        setBlackConnected(false);
        setPausedLeg(false);
        setWhiteBerserk(!!game.berserk?.white);
        setBlackBerserk(!!game.berserk?.black);
        const viewerRole: Role = isWhite
          ? "white"
          : isBlack
            ? "black"
            : "spectator";
        setRole(viewerRole);
        roleRef.current = viewerRole;
        setGameOver({
          result: game.result ?? null,
          reason: game.endReason ?? "unknown",
          wagerSettlement: null,
        });
        // Don't auto-pop the modal for a game that's been over for a
        // while — the inline "Game over — …" header line is enough, same
        // as the old standalone replay page. Marking it dismissed here
        // also unlocks the "Rematch" action item below, for games where
        // that still makes sense.
        setGameOverModalDismissed(true);
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
    if (mode !== "board" || !socket || !gameMeta || !live) return;
    const gameId = gameMeta._id;
    setConnStatus("Connecting…");
    cageMatchOverRef.current = false;

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
      // The initial REST fetch runs before an opponent has necessarily
      // joined, so gameMeta.black can still be null at that point — this
      // is what actually keeps the player panels current once someone
      // does join (or on any later resync/reconnect), instead of being
      // stuck showing the "Black"/"White" placeholder forever.
      setGameMeta((prev) =>
        prev ? { ...prev, white: payload.white, black: payload.black } : prev,
      );
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

      playSoundForMove(payload.san);
    }

    function onOver(payload: {
      result: string | null;
      reason: string;
      wagerSettlement?: {
        wagerTokens: number;
        potTokens: number;
        winnerId: string | null;
      } | null;
      whiteRemainingMs?: number | null;
      blackRemainingMs?: number | null;
    }) {
      setStatus(
        payload.reason === "aborted_no_moves" ||
          payload.reason === "idle_timeout"
          ? "aborted"
          : "finished",
      );
      setGameOver(payload);
      setGameOverModalDismissed(cageMatchOverRef.current);
      setDisconnectExpiresAt(null);
      playGameOverSound();
      // The clock display only ticks down live via elapsed-time math while
      // the game is active — once status flips to finished that stops, so
      // without this it would snap back to whatever whiteRemainingMs/
      // blackRemainingMs were as of the *previous* move (e.g. a stale ~3s)
      // instead of resting at the actual final time (0 for a timeout).
      if (payload.whiteRemainingMs !== undefined)
        setWhiteRemainingMs(payload.whiteRemainingMs);
      if (payload.blackRemainingMs !== undefined)
        setBlackRemainingMs(payload.blackRemainingMs);

      // A wager payout/refund (or the stake being locked away in the first
      // place) changes the R Coin balance — refresh the shared store so the
      // navbar badge and dashboard update without needing a reload.
      if (payload.wagerSettlement && payload.wagerSettlement.wagerTokens > 0) {
        refreshBalance().catch(() => {});
      }
    }

    function onError(payload: { message: string }) {
      setMoveError(payload.message);
    }

    function markConnection(userId: string, connected: boolean) {
      if (gameMetaRef.current?.white?._id === userId)
        setWhiteConnected(connected);
      if (gameMetaRef.current?.black?._id === userId)
        setBlackConnected(connected);
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

      setDisconnectExpiresAt(Date.now() + payload.graceMs);
    }

    function onClaimAvailable() {
      if (roleRef.current === "spectator") return;
      // Already-past timestamp — DisconnectBanner treats that as
      // immediately claimable, same as when the countdown reaches zero.
      setDisconnectExpiresAt(Date.now());
    }

    function onOpponentReconnected(payload: { userId: string }) {
      markConnection(payload.userId, true);
      setDisconnectExpiresAt(null);
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
      if (payload.matchId !== gameMetaRef.current?.cageMatchId) return;
      setPauseRequestSent(true);
    }

    function onPauseDeclinedLocal(payload: { matchId: string }) {
      if (payload.matchId !== gameMetaRef.current?.cageMatchId) return;
      setPauseRequestSent(false);
    }

    function onResumeRequestSent(payload: { matchId: string }) {
      if (payload.matchId !== gameMetaRef.current?.cageMatchId) return;
      setResumeRequestSent(true);
    }

    function onResumeDeclinedLocal(payload: { matchId: string }) {
      if (payload.matchId !== gameMetaRef.current?.cageMatchId) return;
      setResumeRequestSent(false);
    }

    // The last leg of a cage match finishing fires both this game's
    // `game:over` (which would normally pop the per-leg GameOverModal) AND
    // the global `cage:match_over` (which pops CageMatchOverModal via
    // GlobalListeners) at essentially the same moment. Showing both stacked
    // is confusing, so once the whole match is over, the per-leg modal steps
    // aside and lets the match-level popup be the single source of truth —
    // regardless of which of the two events this client happens to process
    // first.
    function onCageMatchOverOnThisLeg(payload: { matchId: string }) {
      if (payload.matchId !== gameMetaRef.current?.cageMatchId) return;
      cageMatchOverRef.current = true;
      setGameOverModalDismissed(true);
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
    socket.on("cage:match_over", onCageMatchOverOnThisLeg);

    // Covers the common case where the socket is already connected by the
    // time this effect runs (normal navigation to the page).
    if (socket.connected) joinRoom();

    return () => {
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
      socket.off("cage:match_over", onCageMatchOverOnThisLeg);
    };
  }, [mode, socket, gameMeta?._id, notify, live]);

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
        ? `Your ${gameMeta.wagerTokens} R Coin stake will be refunded.`
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

  function handleFlipBoard() {
    setBoardFlipped((f) => !f);
  }

  /** Jumps straight to the position right after a given move (`ply` is
   *  1-indexed, matching `moveNumber`). Selecting the current last move
   *  snaps back to `null` (live) rather than an equal-but-distinct ply
   *  number, so it behaves identically to Next walking off the end.
   *  Also plays the same move/capture/check sound a live move would have
   *  — landing on a ply plays the sound for the move that produced it, in
   *  either direction, the same as clicking through a game on lichess.
   *  No-ops (including no sound) if the requested ply is where the view
   *  already is, so holding a button past the end of the list doesn't
   *  spam a sound on every repeat tick.
   *
   *  useCallback so MoveList/MoveStrip below — both React.memo'd — get a
   *  stable handleSelectMove reference across the page's many unrelated
   *  re-renders (chat input, move errors, etc.) instead of rebuilding
   *  their entire move-button list every time any of that state changes. */
  const goToPly = useCallback(
    (rawPly: number) => {
      const currentPly = viewPly ?? liveViewPly;
      const clamped = Math.max(0, Math.min(liveViewPly, rawPly));
      if (clamped === currentPly) return;
      setViewPly(clamped >= liveViewPly ? null : clamped);
      if (clamped > 0) playSoundForMove(moves[clamped - 1]?.san);
    },
    [viewPly, liveViewPly, moves],
  );

  const handleSelectMove = useCallback(
    (ply: number) => goToPly(ply),
    [goToPly],
  );

  function handlePrevMove() {
    goToPly((viewPly ?? liveViewPly) - 1);
  }

  function handleNextMove() {
    if (viewPly === null) return; // already live, nothing to advance to
    goToPly(viewPly + 1);
  }

  // Declared here (before the loadError/mode early returns below) rather
  // than down by the buttons that use them, since hooks — useHoldRepeat
  // included — have to run unconditionally on every render.
  const prevHold = useHoldRepeat(handlePrevMove);
  const nextHold = useHoldRepeat(handleNextMove);

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
              <strong>{gameMeta.wagerTokens} R Coins</strong> from your balance.
              The winner takes the full {gameMeta.wagerTokens * 2}.
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

  const showChat = !settings.zenMode && role === "spectator" && live;

  // Which ply is "selected" right now — the one being browsed, or the
  // live move if nothing's being browsed. Drives the highlight below.
  const currentPly = viewPly ?? liveViewPly;

  // Rendered directly (not built as a JSX variable) further down — both are
  // React.memo'd (see components/MoveLog.tsx) so they only actually re-render
  // when `moves`/`currentPly`/`handleSelectMove` change, not on every one of
  // the page's unrelated state updates.
  const moveListEntries =
    moves.length === 0 ? null : (
      <MoveList
        moves={moves}
        currentPly={currentPly}
        onSelectMove={handleSelectMove}
      />
    );
  const moveStripEntries =
    moves.length === 0 ? null : (
      <MoveStrip
        moves={moves}
        currentPly={currentPly}
        onSelectMove={handleSelectMove}
        scrollRef={moveStripScrollRef}
      />
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
          className="h-10 flex-1 rounded-lg border border-base-300 bg-base-200 px-3 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-(--primary)"
        />
        <Button type="submit" size="md">
          Send
        </Button>
      </form>
    </>
  );

  const chatHeader = (
    <>
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
        Only visible to spectators, not the players. Not saved — refreshing
        clears it.
      </p>
    </>
  );

  // Resign/draw/abort — the trio of "give up on the game" actions. Abort is
  // only for normal games during the idle phase (before either side has
  // moved), mirroring the lichess-style abort window — cage match legs get
  // "pause" as their idle-phase escape hatch instead (see below), and
  // tournament pairings get neither, so walking away from a bracket game
  // isn't this cheap. Resign/offer-draw only become available once the idle
  // phase ends (both sides have moved at least once) — before that there's
  // nothing to resign from yet, hence the Abort branch is mutually exclusive
  // with them. Rendered as plain inline Buttons in the right panel from md
  // up, and collapsed into a single dropup trigger (via the Dropdown
  // primitive, side="top") on phone where there's no right panel to put
  // them in.
  //
  // Once the game's over and its modal has been dismissed, that space is
  // reused for a single "Rematch" entry that just reopens GameOverModal —
  // it's the only place with the actual offer-rematch button (and its
  // "offer sent" disabled state), so this doesn't duplicate that logic,
  // it just gets the modal back on screen. Mutually exclusive with the
  // trio above: status can't be "active" once gameOver is set. Cage match
  // legs never offer a rematch — the series has its own next-leg/forfeit
  // flow instead.
  const isIdlePhase = moves.length < 2;
  const canReopenRematch =
    !!gameOver &&
    gameOverModalDismissed &&
    isPlayer &&
    !gameMeta?.cageMatchId &&
    gameOver.reason !== "aborted_no_moves" &&
    gameOver.reason !== "idle_timeout" &&
    gameOver.reason !== "cage_forfeit";
  const actionItems: any[] = [
    {
      label: boardFlipped ? "Unflip board" : "Flip board",
      icon: FlipVertical2,
      onClick: handleFlipBoard,
      danger: false,
      mobilePrimary: true,
    },
    {
      label: "Previous move",
      icon: ChevronLeft,
      id: "prev",
      onClick: handlePrevMove,
      danger: false,
      disabled: liveViewPly === 0 || viewPly === 0,
      mobilePrimary: true,
    },
    {
      label: "Next move",
      icon: ChevronRight,
      id: "next",
      onClick: handleNextMove,
      danger: false,
      disabled: viewPly === null,
      mobilePrimary: true,
    },
    ...(isPlayer && status === "active" && !isIdlePhase
      ? [
          { label: "Offer draw", icon: Handshake, onClick: handleOfferDraw },
          {
            label: "Resign",
            icon: Flag,
            onClick: handleResign,
            danger: true,
          },
        ]
      : []),
    ...(isPlayer &&
    status === "active" &&
    isIdlePhase &&
    !gameMeta?.cageMatchId &&
    !gameMeta?.tournamentId
      ? [{ label: "Abort", icon: Ban, onClick: handleAbort, danger: true }]
      : []),
    ...(isPlayer &&
    gameMeta?.cageMatchId &&
    status === "active" &&
    isIdlePhase &&
    !pausedLeg
      ? [
          {
            label: pauseRequestSent ? "Pause request sent…" : "Request pause",
            icon: Pause,
            onClick: handlePauseRequest,
            danger: false,
            disabled: pauseRequestSent,
          },
        ]
      : []),
    ...(isPlayer && gameMeta?.cageMatchId
      ? [
          {
            label: "Forfeit entire cage match",
            icon: Ban,
            onClick: handleForfeitCageMatch,
            danger: true,
          },
        ]
      : []),
    ...(showChat
      ? [
          {
            label: "Spectator chat",
            icon: MessageSquare,
            onClick: () => setChatSheetOpen(true),
            danger: false,
            mobilePrimary: true,
          },
        ]
      : []),
    ...(canReopenRematch
      ? [
          {
            label: "Rematch",
            icon: RefreshCw,
            onClick: () => setGameOverModalDismissed(false),
            danger: false,
          },
        ]
      : []),
  ];
  const shareItem = {
    label: "Share game link",
    icon: Share2,
    onClick: handleShareGame,
    danger: false,
  };
  // Mobile pill: Flip board, Share, Prev/Next move, and Spectator chat (when
  // present) stay always visible — they're the ones reached for constantly
  // mid-game. Everything else (resign/draw/abort/pause/forfeit/rematch)
  // collapses into the "More" dropup so the pill doesn't sprawl across a
  // phone screen. Desktop is untouched — it still renders the full
  // actionItems list as-is in the right panel.
  const mobilePrimaryItems = [
    ...actionItems.filter((item) => item.mobilePrimary),
    shareItem,
  ];
  const mobileOverflowItems = actionItems.filter((item) => !item.mobilePrimary);

  return (
    <div className="relative mx-auto min-h-[calc(100dvh-7rem)] flex max-w-6xl flex-col justify-center gap-2 pb-20 md:gap-3 md:pb-2">
      {/* Notification overlay stack — leg-paused notice, waiting-for-
       *  opponent, move errors, the paused-leg resume card, and the
       *  opponent-disconnect banner. All absolute + centered over the page
       *  instead of sitting inline above the board, so any one of them
       *  popping in or out mid-game never shifts the board or panels
       *  beneath it. Stacked in one flex column (rather than each doing
       *  its own absolute math like the old disconnect-only version) so
       *  multiple notifications showing at once — say a move error right
       *  as the opponent disconnects — line up instead of overlapping.
       *  The wrapper is pointer-events-none so empty space over the board
       *  stays clickable/draggable; each banner opts back into
       *  pointer-events-auto for its own buttons. */}
      <div className="pointer-events-none absolute inset-x-0 top-2 z-30 mx-auto flex w-[min(92vw,26rem)] flex-col items-stretch gap-2">
        <AnimatePresence>
          {pausedLeg && !gameOver && (
            <motion.div
              key="paused-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springSnappy}
              className="pointer-events-auto flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-base-200 p-2.5 text-center text-sm text-amber-500 shadow-lg"
            >
              <Pause className="h-4 w-4" /> This leg is paused
              {isPlayer ? "" : " by the players"}.
            </motion.div>
          )}

          {moveError && (
            <motion.p
              key="move-error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springSnappy}
              className="pointer-events-auto rounded-xl bg-base-100 px-3 py-2 text-center text-sm text-red-400 shadow-lg"
            >
              {moveError}
            </motion.p>
          )}

          {isPlayer && gameMeta?.cageMatchId && pausedLeg && (
            <motion.div
              key="paused-card"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={springSnappy}
              className="pointer-events-auto"
            >
              <Card
                variant="strong"
                className="border-amber-500/30 text-sm text-amber-500 shadow-xl"
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
                  {resumeRequestSent
                    ? "Resume request sent…"
                    : "Request resume"}
                </Button>
              </Card>
            </motion.div>
          )}

          {disconnectExpiresAt !== null && !isIdlePhase && (
            <DisconnectBanner
              expiresAt={disconnectExpiresAt}
              onClaim={handleClaim}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Main layout — a plain top-to-bottom stack on phone (details, board,
       *  panels flanking it top/bottom), becoming a CSS grid from md up
       *  (see .game-grid in index.css): a 2-column board/right-panel grid
       *  with the details+moves block spanning full width above it on
       *  tablet, and a 3-column details/board/right-panel grid on desktop,
       *  where the board's grid column is the widest of the three so it
       *  reads as visually larger than the side panels. */}
      <div className="game-grid min-h-0 flex-1">
        {/* Game details — code, share, badges, status, and the move list.
         *  (Spectator chat's trigger now lives in the action button row.)
         *  Left column on desktop; a full-width strip above the board/panel
         *  row on tablet and phone. */}
        <div className="game-area-leftinfo sm:px-0 px-5 flex shrink-0 flex-col justify-center gap-3 lg:h-full lg:min-h-0">
          <Card variant="solid">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {badges.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {badges}
                  </div>
                )}
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

            {!settings.zenMode && (
              <div className="min-h-0 lg:flex lg:flex-col">
                {/* Vertical list — tablet & desktop. */}
                <h2 className="hidden lg:flex mt-3 text-base-content/40 text-sm font-semibold">
                  Moves
                </h2>
                <div
                  ref={moveListScrollRef}
                  className="hidden min-h-0 overflow-y-auto max-h-40 mb-1 pr-1 lg:block lg:flex-1"
                >
                  {moveListEntries ?? <></>}
                </div>
                <div className="lg:hidden min-h-7">{moveStripEntries}</div>
              </div>
            )}
          </Card>
        </div>

        <div className="game-area-board relative flex flex-col flex-1 items-center justify-center">
          <div className="game-area-toppanel md:hidden w-[95%]">
            <PlayerPanelRow {...opponentPanelData} />
          </div>
          <div
            className={`relative aspect-square w-full rounded-2xl flex items-center shadow- overflow-hidden board-theme-${settings.boardTheme} piece-theme-${settings.pieceTheme} justify-center bg-purple-700 `}
          >
            <ChessBoard
              fen={displayFen}
              orientation={
                boardFlipped
                  ? myColor === "black"
                    ? "white"
                    : "black"
                  : (myColor ?? "white")
              }
              viewOnly={
                !isPlayer ||
                status !== "active" ||
                pausedLeg ||
                isViewingHistory
              }
              turnColor={chess.turn() === "w" ? "white" : "black"}
              movableColor={myColor}
              dests={dests}
              premoveDests={premoveDests}
              inCheck={inCheck}
              lastMove={displayLastMove}
              onUserMove={handleUserMove}
              animationEnabled={settings.pieceAnimation}
              showCoordinates={settings.showCoordinates}
              showLegalMoves={settings.showLegalMoves}
            />
            {isPlayer && status === "waiting" && (
              <div className="pointer-events-none absolute bg-base-200/30 inset-0 px-3 justify-center items-center top-2 z-30 mx-auto flex">
                <motion.div
                  key="waiting-banner"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={springSnappy}
                  className="pointer-events-auto flex items-center gap-3 rounded-xl border border-base-300 bg-base-100 px-3 py-2.5 shadow-lg"
                >
                  <p className="flex-1 text-sm text-base-content/60">
                    Waiting for an opponent to join…
                  </p>
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={handleCancelWaitingGame}
                  >
                    <Ban className="h-4 w-4" /> Cancel game
                  </Button>
                </motion.div>
              </div>
            )}
            {promoPending && <PromotionPicker onPick={handlePromotionPick} />}
          </div>
          <div className="game-area-bottompanel md:hidden w-[95%]">
            <PlayerPanelRow {...myPanelData} />
          </div>
        </div>

        {/* Right panel — tablet & desktop. Player panels, the cage match
         *  scoreboard (if any), then the action buttons (flip/prev/next,
         *  resign/draw/cage-match, spectator chat trigger) pinned to the
         *  bottom via mt-auto. Spectator chat itself opens as a right-side
         *  drawer from here, or a bottom sheet on phone — see the drawer
         *  markup near the end of the component. */}
        <div className="game-area-rightpanel justify-center min-h-0 flex-col gap-3">
          <div>
            <Card variant="solid" className="shrink-0 space-y-2">
              <PlayerPanelRow {...opponentPanelData} />

              <PlayerPanelRow {...myPanelData} />
            </Card>

            {!settings.zenMode && gameMeta?.cageMatchId && (
              <div className="mt-auto hidden md:block pt-2">
                <CageMatchScoreboard
                  cageMatchId={gameMeta.cageMatchId}
                  legIndex={gameMeta.legIndex ?? 0}
                />
              </div>
            )}

            {actionItems.length > 0 && (
              <div
                className={`hidden md:flex flex-wrap justify-center shrink-0 gap-2 pt-2 ${
                  !settings.zenMode && gameMeta?.cageMatchId ? "" : "mt-auto"
                }`}
              >
                {actionItems.map((item) => {
                  const hold =
                    item.id === "prev"
                      ? prevHold
                      : item.id === "next"
                        ? nextHold
                        : null;
                  return (
                    <Tooltip key={item.label} content={item.label}>
                      <Button
                        variant={item.danger ? "danger" : "glass"}
                        disabled={item.disabled}
                        {...(hold ?? { onClick: item.onClick })}
                      >
                        <item.icon className="h-4 w-4" />
                      </Button>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        {/* Standalone berserk CTA — a persistent control a player
         *  deliberately reaches for, not a transient alert, so it lives in
         *  normal flow rather than the notification overlay stack above.
         *  Moved down here (bottom of the page) instead of above the
         *  board, out of the way of the board/panels the player is
         *  actually looking at during the opening moves. */}
        {isPlayer &&
          status === "active" &&
          gameMeta?.tournamentId &&
          myColor &&
          !(myColor === "white" ? whiteBerserk : blackBerserk) &&
          (myColor === "white" ? moves.length === 0 : moves.length <= 1) && (
            <div className="flex justify-center pt-2">
              <Button
                size="sm"
                onClick={handleBerserk}
                className="border border-red-800 bg-red-950/30 text-red-300 shadow-none hover:bg-red-950/50 hover:brightness-100"
              >
                <Swords className="h-4 w-4" /> Berserk — halve your clock for a
                bonus point
              </Button>
            </div>
          )}

        {!settings.zenMode && gameMeta?.cageMatchId && (
          <div className="md:hidden pt-2">
            <CageMatchScoreboard
              cageMatchId={gameMeta.cageMatchId}
              legIndex={gameMeta.legIndex ?? 0}
            />
          </div>
        )}

        {/* Mobile action pill — fixed to the bottom of the screen instead of
         *  sitting in normal flow, so it's always reachable without
         *  scrolling. Only the items reached for constantly mid-game (flip
         *  board, share link, spectator chat, prev/next move) stay always
         *  visible; the rest (resign/draw/abort/pause/forfeit/rematch)
         *  collapse into the "More" dropup via the Dropdown primitive so the
         *  pill stays a fixed, compact size regardless of game state. */}
        {mobilePrimaryItems.length > 0 && (
          <div
            className="md:hidden fixed inset-x-0 z-40 flex justify-center px-3"
            style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <div className="glass-strong flex items-center gap-1 rounded-full p-1.5">
              {mobilePrimaryItems.map((item) => {
                const hold =
                  item.id === "prev"
                    ? prevHold
                    : item.id === "next"
                      ? nextHold
                      : null;
                return (
                  <Tooltip key={item.label} content={item.label}>
                    <button
                      type="button"
                      aria-label={item.label}
                      disabled={item.disabled}
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-base-content/80 transition-colors hover:bg-base-content/10 hover:text-base-content disabled:opacity-40 disabled:pointer-events-none"
                      {...(hold ?? { onClick: item.onClick })}
                    >
                      <item.icon className="h-4 w-4" />
                    </button>
                  </Tooltip>
                );
              })}
              {mobileOverflowItems.length > 0 && (
                <Dropdown
                  trigger={
                    <button
                      type="button"
                      aria-label="More actions"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-base-content/80 transition-colors hover:bg-base-content/10 hover:text-base-content"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  }
                  items={mobileOverflowItems}
                  align="end"
                  side="top"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Spectator chat — a bottom sheet on phone, a right-side drawer from
       *  md up. Both variants share one backdrop and one open/close state;
       *  only one of the two panel variants is ever visible at a given
       *  breakpoint (the other stays mounted but hidden via Tailwind's
       *  responsive display classes), so there's no per-breakpoint branching
       *  in JS — just CSS deciding which one shows. */}
      <AnimatePresence>
        {showChat && chatSheetOpen && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setChatSheetOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Bottom sheet — phone only. */}
            <motion.div
              className="glass-strong absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl p-4 md:hidden"
              style={{
                paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
              }}
              onClick={(e) => e.stopPropagation()}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={springSnappy}
            >
              {chatHeader}
              {chatBody}
            </motion.div>

            {/* Right-side drawer — tablet & desktop. */}
            <motion.div
              className="glass-strong absolute inset-y-0 right-0 hidden w-full max-w-sm flex-col p-4 md:flex"
              style={{
                paddingTop: "calc(1rem + env(safe-area-inset-top))",
              }}
              onClick={(e) => e.stopPropagation()}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={springSnappy}
            >
              {chatHeader}
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
            !gameMeta?.cageMatchId &&
            gameOver.reason !== "aborted_no_moves" &&
            gameOver.reason !== "idle_timeout" &&
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
