import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trophy,
  FlipVertical,
  Settings,
} from "lucide-react";
import { MoveList, MoveStrip } from "../components/MoveLog.js";
import { PlayerPanelRow, panelMaterial } from "../components/PlayerPanels.js";
import {
  GameOverModal,
  titleFor,
  reasonText,
} from "../components/GameOverModal.js";
import { CageMatchScoreboard } from "../components/CageMatchScoreboard.js";
import {
  Card,
  Badge,
  Spinner,
  Button,
  RCoin,
  TimeControlIcon,
} from "../components/ui/index.js";
import {
  type GameMeta,
  type MoveLogEntry,
  type Role,
  type RatingUpdate,
  type WagerSettlement,
  isLiveStatus,
  playSoundForMove,
} from "../components/game/types.js";
import { useHoldRepeat } from "../components/game/useHoldRepeat.js";
import { GameNotificationsOverlay } from "../components/game/GameNotificationsOverlay.js";
import { GameChatPanel } from "../components/game/GameChatPanel.js";
import type { ChatMessage } from "../lib/chatTypes.js";
import { useMyActiveGame } from "../contexts/MyActiveGameContext.js";
import {
  GameActionBarDesktop,
  GameActionBarMobile,
} from "../components/game/GameActionBar.js";
import { GameBoardArea } from "../components/game/GameBoardArea.js";
import { GameDetailsCard } from "../components/game/GameDetailsCard.js";
import {
  computeDests,
  needsPromotion,
  isInCheck,
  computePremoveDests,
  addChess960CastlingDests,
  computeMaterialDiff,
  computeLowTimeThresholdMs,
  computeFirstMoveThresholdMs,
  reconstructPlyClocks,
  turnColor,
} from "../chessUtils.js";
import { refreshBalance } from "../api/walletStore.js";
import {
  playGameStartSound,
  playGameOverSound,
  playLowTimeSound,
  playBerserkSound,
  setSoundEnabled,
} from "../sounds.js";
import { copyToClipboard } from "@/lib/utils.js";
import {
  formatTimeControl,
  animationDurationForTimeControl,
} from "../timeControls.js";

export function Game() {
  const { code = "" } = useParams<{ code: string }>();
  const { user } = useAuth();
  const { setActiveGame, clearActiveGame } = useMyActiveGame();
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
  // `gameMeta` object itself, that object gets a new reference on every
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
  // Set once, from the initial REST fetch below, and never flipped back,
  // a game that's live when this page loads stays on the socket-driven
  // path for the rest of the session even if it finishes while open (the
  // existing game:over handling already covers that). Only a *fresh* load
  // of an already-finished game takes the stale path.
  const [live, setLive] = useState(true);

  const [role, setRole] = useState<Role>("spectator");
  const roleRef = useRef<Role>("spectator");
  // `game:over` and `cage:match_over` can arrive in either order when the
  // final leg of a cage match finishes (see onCageMatchOverOnThisLeg below)
  //, this makes the "skip the per-leg modal" decision order-independent.
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
    wagerSettlement?: WagerSettlement | null;
    ratingUpdate?: RatingUpdate | null;
  } | null>(null);
  const [whiteConnected, setWhiteConnected] = useState(false);
  const [blackConnected, setBlackConnected] = useState(false);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [moveError, setMoveError] = useState("");
  const [promoPending, setPromoPending] = useState<{
    orig: string;
    dest: string;
  } | null>(null);
  // Just the expiry timestamp. DisconnectBanner (a separate component)
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatHasUnread, setChatHasUnread] = useState(false);
  // Board flip is purely a local viewing preference, it doesn't touch
  // `myColor`/server state at all, just which edge of the board the local
  // player's pieces render on.
  const [boardFlipped, setBoardFlipped] = useState(false);
  // Move browsing: null means "tracking the live position" (the normal
  // state). A number is the ply being viewed (0 = starting position, 1 =
  // after white's 1st move, etc). Prev/Next walk this back and forth;
  // Next snaps back to `null` once it reaches the live ply so newly
  // arriving moves resume being followed automatically.
  const [viewPly, setViewPly] = useState<number | null>(null);
  // Mirror viewPly/moves for goToPly below, see that callback's own
  // comment for why it needs refs instead of closing over the state
  // directly.
  const viewPlyRef = useRef<number | null>(viewPly);
  const movesRef = useRef<MoveLogEntry[]>([]);
  // Spectator chat lives in a bottom-sheet modal on mobile (there's no
  // room for a persistent chat card next to a board that has to fit the
  // viewport) instead of always-visible inline like on desktop.
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const chatSheetOpenRef = useRef(chatSheetOpen);
  useEffect(() => {
    chatSheetOpenRef.current = chatSheetOpen;
  }, [chatSheetOpen]);
  const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? "http://localhost:5173";

  const chess = useMemo(() => new Chess(fen), [fen]);
  const myColor: "white" | "black" | undefined =
    role === "white" || role === "black" ? role : undefined;

  // PREMOVE LOGIC: these must be memoized, not recomputed inline on every
  // render, AND, just as importantly, declared unconditionally up here
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
  // backwards from. `chess` above is deliberately left alone, dests/
  // premoveDests/turnColor everywhere else must keep reflecting the real,
  // live position even while the board is visually showing history.
  // Incrementally extended, not fully replayed from scratch, on every move.
  // A naive `useMemo` keyed on [initialFen, moves] still re-runs the whole
  // replay any time the `moves` array gets a new reference, which is every
  // single move, since onMove does `setMoves(prev => [...prev, entry])|,
  // so a full from-scratch replay was chess.js-validating every move of the
  // game over again on top of the one move that just landed. That's exactly
  // the wrong moment to spend extra main-thread time: it's the same render
  // where the board needs to update for the player who just moved. Since
  // `moves` is appended immutably (the prefix keeps the same object
  // references), the cache below can detect "just one new move got
  // appended" via cheap reference equality and only replay that one move
  // against the last cached fen, falling back to a full replay only when
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
      // Shouldn't happen, the move list came from the server, but a
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

  // Scaled to the time control (see computeLowTimeThresholdMs), a flat
  // "10 seconds left" doesn't mean the same thing in bullet vs. classical.
  const lowTimeThresholdMs = useMemo(
    () => computeLowTimeThresholdMs(gameMeta?.timeControl.baseSeconds ?? null),
    [gameMeta?.timeControl.baseSeconds],
  );

  // Same idea, for the board's piece-slide speed, bullet games get quick
  // snaps, classical games get a slower, easier-to-follow slide. See
  // animationDurationForTimeControl's own comment for the bucket cutoffs.
  const animationDurationMs = useMemo(
    () =>
      animationDurationForTimeControl(
        gameMeta?.timeControl.baseSeconds ?? null,
      ),
    [gameMeta?.timeControl.baseSeconds],
  );

  // --- Live clocks + material diff, computed once and handed down to
  // whichever panel presentation (row on desktop, flank on mobile) is
  // actually rendered, so there's exactly one ticking source of truth. ---
  // NOTE: this whole block, through opponentPanelData below, deliberately
  // lives up here with the other unconditional hooks (dests/premoveDests/
  // historyFens above) rather than down near where it's actually rendered.
  // It contains useMemo calls, and there are three early `return`s for
  // loadError/mode==="loading"/mode==="need-join" between here and there,
  // hooks placed after those fire a different number of times depending on
  // which branch a given render takes, which is exactly the
  // "Rendered more hooks than during the previous render" crash. Same
  // reasoning as the comment on dests/premoveDests above.
  const sideToMove = turnColor(chess);
  // Memoized on `displayFen`, the position actually on screen, which is
  // the live position normally but the historical one while browsing
  // moves (see isViewingHistory/displayFen above), so the material
  // count on the panels always matches what's drawn on the board, not
  // the live game state you've scrolled away from.
  const material = useMemo(() => computeMaterialDiff(displayFen), [displayFen]);
  // Per-move clock reconstruction, see reconstructPlyClocks for the exact
  // rules this mirrors from the server. Recomputed only when the move list
  // itself changes (new move, or a fresh load), not on every render/tick,
  // this data doesn't change while just scrubbing through history, only
  // the ply you're pointing at does. Skips entirely if any move is
  // missing a timestamp (an older live session that predates this field)
  // rather than silently producing a garbage-in-garbage-out result.
  const plyClocks = useMemo(() => {
    if (!gameMeta || moves.length === 0) return null;
    if (!moves.every((m) => typeof m.timestampMs === "number")) return null;
    return reconstructPlyClocks({
      baseSeconds: gameMeta.timeControl.baseSeconds,
      incrementSeconds: gameMeta.timeControl.incrementSeconds,
      moveTimestampsMs: moves.map((m) => m.timestampMs!),
      berserk: { white: whiteBerserk, black: blackBerserk },
    });
  }, [gameMeta, moves, whiteBerserk, blackBerserk]);
  // moves[] annotated with each move's reconstructed remaining-time/
  // think-time, handed to MoveList/MoveStrip so they can show a lichess-
  // style clock reading (and think time) next to each move without every
  // consumer needing to know about reconstructPlyClocks itself.
  const annotatedMoves = useMemo(
    () =>
      moves.map((m, i) => ({
        ...m,
        remainingMs: plyClocks?.[i]?.remainingMs ?? null,
        thinkTimeMs: plyClocks?.[i]?.thinkTimeMs ?? null,
      })),
    [moves, plyClocks],
  );
  // Each side's clock as of the position currently on screen while
  // browsing history, the last reconstructed reading for that side at or
  // before `viewPly`, or the untouched starting time if that side hasn't
  // moved yet at this point in the game. Only used while isViewingHistory;
  // live play keeps ticking off whiteRemainingMs/blackRemainingMs as
  // before (see the panel data memos below, which pick between the two).
  const historicalClock = useMemo(() => {
    if (!isViewingHistory || viewPly === null) return null;
    const baseMs =
      gameMeta?.timeControl.baseSeconds != null
        ? gameMeta.timeControl.baseSeconds * 1000
        : null;
    let white = baseMs;
    let black = baseMs;
    if (plyClocks) {
      for (let i = 0; i < viewPly; i++) {
        const clock = plyClocks[i];
        if (!clock) continue;
        if (i % 2 === 0) white = clock.remainingMs;
        else black = clock.remainingMs;
      }
    }
    return { white, black };
  }, [isViewingHistory, viewPly, plyClocks, gameMeta?.timeControl.baseSeconds]);
  const effectiveWhiteRemainingMs = isViewingHistory
    ? (historicalClock?.white ?? null)
    : whiteRemainingMs;
  const effectiveBlackRemainingMs = isViewingHistory
    ? (historicalClock?.black ?? null)
    : blackRemainingMs;
  const effectiveClockKnown =
    effectiveWhiteRemainingMs !== null && effectiveBlackRemainingMs !== null;
  const whiteMaterial = useMemo(
    () => panelMaterial("white", material),
    [material],
  );
  const blackMaterial = useMemo(
    () => panelMaterial("black", material),
    [material],
  );
  const isActiveGame = status === "active";
  // The full grace window for this game: 25s for a plain game, 30s for a
  // cage match leg or tournament pairing, see computeFirstMoveThresholdMs.
  // Only the side whose first move is still pending actually gets a
  // non-null value passed down to their panel; see below.
  const firstMoveGraceMs = useMemo(
    () =>
      computeFirstMoveThresholdMs(
        !!gameMeta?.cageMatchId || !!gameMeta?.tournamentId,
      ),
    [gameMeta?.cageMatchId, gameMeta?.tournamentId],
  );
  // Whose first move is currently the one on the clock: white's, until
  // white's first move lands (moves.length 0), then black's until black's
  // first move lands (moves.length 1). Never both, never neither, while the
  // game's still in that idle phase, and not relevant at all once it's not
  // (isActiveGame false, or paused for a cage match leg).
  const firstMovePendingSide: "white" | "black" | null =
    isActiveGame && !pausedLeg
      ? moves.length === 0
        ? "white"
        : moves.length === 1
          ? "black"
          : null
      : null;

  // Memoized: PlayerPanelRow/PlayerPanelFlank are React.memo'd, but a plain
  // object literal here would be a brand-new reference on every render of
  // Game (which re-renders often, chat input, move errors, banners…),
  // defeating that memo every single time regardless of whether any of
  // these values actually changed. useMemo keeps the reference stable
  // across renders where none of the listed dependencies moved.
  const whitePanelData = useMemo(
    () => ({
      username: gameMeta?.white?.username ?? "White",
      avatarGradient: gameMeta?.white?.avatarGradient,
      isTurn: isActiveGame && sideToMove === "white",
      connected: whiteConnected,
      baseRemainingMs: effectiveWhiteRemainingMs,
      turnStartedAtMs,
      isTicking: !isViewingHistory && clockRunning && sideToMove === "white",
      clockKnown: effectiveClockKnown,
      lowTimeThresholdMs,
      firstMoveGraceMs:
        firstMovePendingSide === "white" ? firstMoveGraceMs : null,
      berserked: whiteBerserk,
      profileHref: gameMeta?.white
        ? `/profile/${gameMeta.white.username}`
        : null,
      ratingCategory: gameMeta?.white?.ratingCategory ?? null,
      zenMode: settings.zenMode,
      ...whiteMaterial,
    }),
    [
      gameMeta?.white?.username,
      gameMeta?.white?.avatarGradient,
      gameMeta?.white?.ratingCategory,
      isActiveGame,
      sideToMove,
      whiteConnected,
      effectiveWhiteRemainingMs,
      turnStartedAtMs,
      isViewingHistory,
      clockRunning,
      effectiveClockKnown,
      lowTimeThresholdMs,
      firstMovePendingSide,
      firstMoveGraceMs,
      whiteBerserk,
      whiteMaterial,
      settings.zenMode,
    ],
  );
  const blackPanelData = useMemo(
    () => ({
      username: gameMeta?.black?.username ?? "Black",
      avatarGradient: gameMeta?.black?.avatarGradient,
      isTurn: isActiveGame && sideToMove === "black",
      connected: blackConnected,
      baseRemainingMs: effectiveBlackRemainingMs,
      turnStartedAtMs,
      isTicking: !isViewingHistory && clockRunning && sideToMove === "black",
      clockKnown: effectiveClockKnown,
      lowTimeThresholdMs,
      firstMoveGraceMs:
        firstMovePendingSide === "black" ? firstMoveGraceMs : null,
      berserked: blackBerserk,
      profileHref: gameMeta?.black
        ? `/profile/${gameMeta.black.username}`
        : null,
      ratingCategory: gameMeta?.black?.ratingCategory ?? null,
      zenMode: settings.zenMode,
      ...blackMaterial,
    }),
    [
      gameMeta?.black?.username,
      gameMeta?.black?.avatarGradient,
      gameMeta?.black?.ratingCategory,
      isActiveGame,
      sideToMove,
      blackConnected,
      effectiveBlackRemainingMs,
      turnStartedAtMs,
      isViewingHistory,
      clockRunning,
      effectiveClockKnown,
      lowTimeThresholdMs,
      firstMovePendingSide,
      firstMoveGraceMs,
      blackBerserk,
      blackMaterial,
      settings.zenMode,
    ],
  );
  // The panel matching my seat renders closest to me, bottom on desktop,
  // right-hand flank on mobile; the opponent's is the mirror of that.
  const myPanelData = myColor === "black" ? blackPanelData : whitePanelData;
  const opponentPanelData =
    myColor === "black" ? whitePanelData : blackPanelData;

  // Fires the low-time sound once the moment MY clock first drops under
  // the threshold, then rearms if it climbs back above it (e.g. an
  // increment) so a second low-time stretch can warn again.
  //
  // This runs its own 100ms `setInterval` rather than depending on a
  // shared page-level "tick" state, it only ever calls playLowTimeSound()
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
  // added, but only while live (not while someone's browsing back through
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
  // "whichever is smaller" and re-derive the other dimension from it, so
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
          // Ongoing (or waiting-for-opponent, viewed by its creator),
          // the socket-wiring effect below takes it from here, same as
          // it always has. Also the moment this client learns it's
          // actually playing (not spectating) a live game, whether that's
          // from just having created/joined it or from landing straight
          // on this page (a refresh, or a direct link), which is the one
          // case GlobalListeners' event-driven setActiveGame calls can't
          // cover on their own, there's no socket event for "I reloaded
          // the page I was already on".
          setLive(true);
          if (isWhite || isBlack) setActiveGame(code);
          return;
        }

        // Finished/aborted: a stale, one-shot render. No socket room is
        // ever joined for it, everything the board/panels/move list
        // need is filled in here, once, from the REST payload, the same
        // fields a live game:sync would have set.
        setLive(false);
        if (isWhite || isBlack) clearActiveGame(code);
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
        // while, the inline "Game over, …" header line is enough, same
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
  }, [code, user?.id, setActiveGame, clearActiveGame]);

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
    cageMatchOverRef.current = false;

    function deriveLastMove(
      moveList: MoveLogEntry[],
    ): [string, string] | undefined {
      const last = moveList[moveList.length - 1];
      return last ? [last.from, last.to] : undefined;
    }

    // Room membership does not survive a reconnect, a dropped/restarted
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
      setSpectatorCount(payload.spectatorCount ?? 0);
      setPausedLeg(!!payload.paused);
      setWhiteBerserk(!!payload.berserk?.white);
      setBlackBerserk(!!payload.berserk?.black);
      // The initial REST fetch runs before an opponent has necessarily
      // joined, so gameMeta.black can still be null at that point, this
      // is what actually keeps the player panels current once someone
      // does join (or on any later resync/reconnect), instead of being
      // stuck showing the "Black"/"White" placeholder forever.
      setGameMeta((prev) =>
        prev ? { ...prev, white: payload.white, black: payload.black } : prev,
      );
      const gameIsOver =
        payload.status === "finished" || payload.status === "aborted";
      // Same reasoning as the initial-fetch branch above: this is what
      // catches the game ending while the player is sitting right here on
      // its page, GlobalListeners has no socket event for that (game:over
      // only reaches this game's own room, not a global one), so this is
      // the one place it can be noticed and cleared.
      if (payload.role !== "spectator") {
        if (gameIsOver) clearActiveGame(code);
        else setActiveGame(code);
      }
      setGameOver(
        gameIsOver
          ? { result: payload.result ?? null, reason: payload.endReason }
          : null,
      );
      if (gameIsOver) setGameOverModalDismissed(false);
      // Only ever present for spectators (see gameSocket.ts), replaces
      // whatever was in state rather than merging, this is a full,
      // authoritative history load (initial join, or a reconnect).
      if (Array.isArray(payload.spectatorChatHistory)) {
        setChatMessages(payload.spectatorChatHistory);
      }
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
          timestampMs: payload.timestampMs,
        },
      ]);

      playSoundForMove(payload.san);
    }

    function onOver(payload: {
      result: string | null;
      reason: string;
      wagerSettlement?: WagerSettlement | null;
      ratingUpdate?: RatingUpdate | null;
      whiteRemainingMs?: number | null;
      blackRemainingMs?: number | null;
    }) {
      setStatus(
        payload.reason === "aborted_no_moves" ||
          payload.reason === "idle_timeout"
          ? "aborted"
          : "finished",
      );
      // game:over reaches everyone in the game room, players and
      // spectators alike (unlike game:sync, it doesn't carry a role of
      // its own), so this has to check roleRef rather than assume.
      // Missing this clearActiveGame call at all is exactly why an
      // aborted game's icon kept pinging on the dashboard after leaving
      // the page: game:sync's clearActiveGame only covers the game ending
      // while still watching the live position update, not the
      // abort/resign/timeout confirmation that arrives via this separate
      // event.
      if (roleRef.current !== "spectator") clearActiveGame(code);
      setGameOver(payload);
      setGameOverModalDismissed(cageMatchOverRef.current);
      setDisconnectExpiresAt(null);
      playGameOverSound();
      // The clock display only ticks down live via elapsed-time math while
      // the game is active, once status flips to finished that stops, so
      // without this it would snap back to whatever whiteRemainingMs/
      // blackRemainingMs were as of the *previous* move (e.g. a stale ~3s)
      // instead of resting at the actual final time (0 for a timeout).
      if (payload.whiteRemainingMs !== undefined)
        setWhiteRemainingMs(payload.whiteRemainingMs);
      if (payload.blackRemainingMs !== undefined)
        setBlackRemainingMs(payload.blackRemainingMs);

      // A wager payout/refund (or the stake being locked away in the first
      // place) changes the Rabah Coin balance, refresh the shared store so the
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
      markConnection(payload.userId, true);
      playGameStartSound();
    }

    function onSpectatorCount(payload: { gameId: string; count: number }) {
      if (payload.gameId !== gameId) return;
      setSpectatorCount(payload.count);
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
      playBerserkSound();
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
      // Already-past timestamp. DisconnectBanner treats that as
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

    function onChatMessage(payload: ChatMessage) {
      setChatMessages((prev) => [...prev.slice(-199), payload]);
      // Dot only for messages that arrive while the panel's closed, and
      // not for the echo of your own message (the socket broadcasts to
      // the whole spectator room including the sender).
      if (!chatSheetOpenRef.current && payload.username !== user?.username) {
        setChatHasUnread(true);
      }
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
    // aside and lets the match-level popup be the single source of truth,
    // regardless of which of the two events this client happens to process
    // first.
    function onCageMatchOverOnThisLeg(payload: { matchId: string }) {
      if (payload.matchId !== gameMetaRef.current?.cageMatchId) return;
      cageMatchOverRef.current = true;
      setGameOverModalDismissed(true);
    }

    socket.on("connect", joinRoom);
    socket.on("game:sync", onSync);
    socket.on("game:move", onMove);
    socket.on("game:over", onOver);
    socket.on("game:error", onError);
    socket.on("game:opponent_connected", onOpponentConnected);
    socket.on("game:spectator_count", onSpectatorCount);
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
      socket.emit("game:leave", { gameId });
      socket.off("connect", joinRoom);
      socket.off("game:sync", onSync);
      socket.off("game:move", onMove);
      socket.off("game:over", onOver);
      socket.off("game:error", onError);
      socket.off("game:opponent_connected", onOpponentConnected);
      socket.off("game:spectator_count", onSpectatorCount);
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
  }, [
    mode,
    socket,
    gameMeta?._id,
    notify,
    live,
    code,
    setActiveGame,
    clearActiveGame,
  ]);

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

  async function handleForfeitCageMatch() {
    if (!gameMeta?.cageMatchId || !socket) return;
    const ok = await confirmDialog({
      title: "Forfeit the entire cage match?",
      description:
        "This will forfeit the entire match, not just this game. Your opponent will be declared the overall winner and any remaining games will be skipped.",
      variant: "danger",
      confirmLabel: "Forfeit match",
    });
    if (ok) {
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
        ? `Your ${gameMeta.wagerTokens} R stake will be refunded.`
        : "You can create a new one any time.",
      variant: "danger",
      confirmLabel: "Cancel game",
    });
    if (!ok) return;
    try {
      await cancelGame(gameMeta._id);
      // REST-only action, no socket event fires for it (unlike abort,
      // which goes through game:over), so this is the one place that can
      // clear it, the game:sync/game:over-driven clearActiveGame calls
      // elsewhere in this file never get a chance to run before the
      // navigate() below takes the user away from this page entirely.
      clearActiveGame(code);
      navigate("/");
    } catch (err) {
      setLoadError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not cancel the game",
      );
    }
  }

  function handleBerserk() {
    if (!socket || !gameMeta) return;
    // Deliberately no confirmation popover, like Lichess, berserking is
    // meant to be an instant, no-second-thoughts decision made in the first
    // few seconds of the game, not something that pauses on a dialog.
    socket.emit("game:berserk", { gameId: gameMeta._id });
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
    notify("Rematch offer sent. Waiting for your opponent…", [], 5000);
  }

  const handleShareGame = async () => {
    const url = `${CLIENT_URL}/game/${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join my chess game on Chessr", url });
      } catch (err) {
        // AbortError just means the person closed the share sheet without
        // picking anything, not a failure worth surfacing. Any other
        // failure (e.g. share unexpectedly rejected) falls back to a
        // plain clipboard copy so the action still does *something*.
        if ((err as Error)?.name !== "AbortError") {
          copyToClipboard(url);
          const n = notify("Copied game url");
          setTimeout(() => dismiss(n), 2000);
        }
      }
      return;
    }
    copyToClipboard(url);
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
   *, landing on a ply plays the sound for the move that produced it, in
   *  either direction, the same as clicking through a game on lichess.
   *  No-ops (including no sound) if the requested ply is where the view
   *  already is, so holding a button past the end of the list doesn't
   *  spam a sound on every repeat tick.
   *
   *  useCallback so MoveList/MoveStrip below, both React.memo'd, get a
   *  stable handleSelectMove reference across the page's many unrelated
   *  re-renders (chat input, move errors, etc.) instead of rebuilding
   *  their entire move-button list every time any of that state changes. */
  // Ref-based rather than closing over viewPly/liveViewPly/moves directly:
  // those all change on every single navigation step, which used to give
  // goToPly (and therefore handleSelectMove below) a fresh identity on
  // every step too. MoveList/MoveStrip's per-button memoization (see
  // MoveLog.tsx) depends on onSelectMove staying referentially stable,
  // otherwise every move button would see a "changed" prop on every step
  // and re-render regardless, defeating the whole point of that memo.
  // This callback is now stable for the lifetime of the component.
  useEffect(() => {
    viewPlyRef.current = viewPly;
  }, [viewPly]);
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);
  const goToPly = useCallback((rawPly: number) => {
    const currentMoves = movesRef.current;
    const liveViewPly = currentMoves.length;
    const currentPly = viewPlyRef.current ?? liveViewPly;
    const clamped = Math.max(0, Math.min(liveViewPly, rawPly));
    if (clamped === currentPly) return;
    setViewPly(clamped >= liveViewPly ? null : clamped);
    if (clamped > 0) playSoundForMove(currentMoves[clamped - 1]?.san);
  }, []);

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
  // than down by the buttons that use them, since hooks, useHoldRepeat
  // included, have to run unconditionally on every render.
  const prevHold = useHoldRepeat(handlePrevMove);
  const nextHold = useHoldRepeat(handleNextMove);

  function handleSendChat(message: string, replyToId?: string) {
    if (!socket || !gameMeta) return;
    socket.emit("spectator_chat:send", {
      gameId: gameMeta._id,
      message,
      ...(replyToId ? { replyToId } : {}),
    });
  }

  const isPlayer = role !== "spectator";
  // Keyed off the position actually on screen (live, or historical while
  // browsing, see displayFen above), not always the live `chess` object,
  // otherwise the check highlight would keep showing the live game's check
  // state while scrubbing through a history where a different (or no)
  // check was in effect at that ply.
  const inCheck = useMemo(
    () => isInCheck(isViewingHistory ? new Chess(displayFen) : chess),
    [isViewingHistory, displayFen, chess],
  );

  // Memoized. GameDetailsCard is React.memo'd below it, and a plain array
  // literal here would be a fresh reference on every one of Game's many
  // unrelated re-renders (chat input, move errors, banners…), which would
  // make that memo boundary a no-op since one of its props would always
  // look "changed".
  const badges: ReactNode[] = useMemo(() => {
    if (settings.zenMode) return [];
    const list: ReactNode[] = [];
    if (gameMeta?.timeControl)
      list.push(
        <Badge key="tc" variant="neutral">
          <span className="inline-flex items-center gap-1">
            <TimeControlIcon
              baseSeconds={gameMeta.timeControl.baseSeconds}
              size={12}
            />
            {formatTimeControl(gameMeta.timeControl)}
          </span>
        </Badge>,
      );
    if (gameMeta?.variant === "chess960")
      list.push(
        <Badge key="960" variant="secondary">
          Chess960
        </Badge>,
      );
    if (gameMeta?.wagerTokens)
      list.push(
        <Badge key="wager" variant="warning">
          <span className="inline-flex items-center gap-1">
            {gameMeta.wagerTokens} <RCoin size={10} />
          </span>
        </Badge>,
      );
    if (gameMeta?.tournamentId)
      list.push(
        <Link key="tourney" to={`/tournaments/${gameMeta.tournamentId.code}`}>
          <Badge variant="glass" className="hover:brightness-110">
            {gameMeta.tournamentId.name}
          </Badge>
        </Link>,
      );
    // White/black berserked badges now live on the player panels themselves,
    // right next to the clock they actually affect, see PlayerPanels.tsx's
    // BerserkBadge.
    return list;
  }, [
    settings.zenMode,
    gameMeta?.timeControl,
    gameMeta?.variant,
    gameMeta?.wagerTokens,
    gameMeta?.tournamentId,
  ]);

  const showChat = !settings.zenMode && role === "spectator" && live;

  // Persistent "White Wins. Timeout" style line for GameDetailsCard, see
  // that component's doc comment on resultSummary for why this needs to
  // exist separately from the modal (which only auto-pops once, right when
  // a game ends live; it stays dismissed on every later visit).
  const resultSummary = useMemo(
    () =>
      gameOver
        ? {
            text: `${titleFor(gameOver.result, myColor, isPlayer)}, ${reasonText(gameOver.reason)}`,
            tone: (gameOver.result === null
              ? "neutral"
              : gameOver.result === "draw"
                ? "draw"
                : isPlayer && myColor
                  ? gameOver.result === myColor
                    ? "win"
                    : "loss"
                  : "neutral") as "win" | "loss" | "draw" | "neutral",
            onClick: () => setGameOverModalDismissed(false),
          }
        : null,
    [gameOver, myColor, isPlayer],
  );

  // Which ply is "selected" right now, the one being browsed, or the
  // live move if nothing's being browsed. Drives the highlight below.
  const currentPly = viewPly ?? liveViewPly;

  // Both MoveList/MoveStrip are React.memo'd (see components/MoveLog.tsx)
  // so they only actually re-render when `moves`/`currentPly`/
  // `handleSelectMove` change, but wrapping the elements themselves in
  // useMemo additionally keeps *this* reference stable across Game's many
  // unrelated re-renders, which is what lets GameDetailsCard's own
  // React.memo boundary actually bail instead of always seeing a "new"
  // moveListEntries/moveStripEntries prop.
  const moveListEntries = useMemo(
    () =>
      moves.length === 0 ? null : (
        <MoveList
          moves={annotatedMoves}
          currentPly={currentPly}
          onSelectMove={handleSelectMove}
        />
      ),
    [moves.length, annotatedMoves, currentPly, handleSelectMove],
  );
  const moveStripEntries = useMemo(
    () =>
      moves.length === 0 ? null : (
        <MoveStrip
          moves={annotatedMoves}
          currentPly={currentPly}
          onSelectMove={handleSelectMove}
          scrollRef={moveStripScrollRef}
        />
      ),
    [
      moves.length,
      annotatedMoves,
      currentPly,
      handleSelectMove,
      moveStripScrollRef,
    ],
  );

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
              This is a wagered game. Joining will stake{" "}
              <strong className="inline-flex items-center gap-1">
                {gameMeta.wagerTokens} <RCoin size={13} />
              </strong>{" "}
              from your balance. The winner takes the full{" "}
              {gameMeta.wagerTokens * 2}.
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

  // Resign/draw/abort, the trio of "give up on the game" actions. Abort is
  // only for normal games during the idle phase (before either side has
  // moved), mirroring the lichess-style abort window, cage match legs get
  // "pause" as their idle-phase escape hatch instead (see below), and
  // tournament pairings get neither, so walking away from a bracket game
  // isn't this cheap. Resign/offer-draw only become available once the idle
  // phase ends (both sides have moved at least once), before that there's
  // nothing to resign from yet, hence the Abort branch is mutually exclusive
  // with them. Rendered as plain inline Buttons in the right panel from md
  // up, and collapsed into a single dropup trigger (via the Dropdown
  // primitive, side="top") on phone where there's no right panel to put
  // them in.
  //
  // Once the game's over and its modal has been dismissed, that space is
  // reused for a single "Rematch" entry that just reopens GameOverModal,
  // it's the only place with the actual offer-rematch button (and its
  // "offer sent" disabled state), so this doesn't duplicate that logic,
  // it just gets the modal back on screen. Mutually exclusive with the
  // trio above: status can't be "active" once gameOver is set. Cage match
  // legs never offer a rematch, the series has its own next-leg/forfeit
  // flow instead.
  // Once the game's over and its modal has been dismissed, that space is
  // reused for a single "Rematch" entry that just reopens GameOverModal,
  // it's the only place with the actual offer-rematch button (and its
  // "offer sent" disabled state), so this doesn't duplicate that logic,
  // it just gets the modal back on screen. Mutually exclusive with the
  // trio above: status can't be "active" once gameOver is set. Cage match
  // legs and tournament pairings never offer a rematch, a cage match has
  // its own next-leg/forfeit flow, and a tournament bracket is fixed by the
  // pairing schedule, not something either player gets to spin up again.
  const isIdlePhase = moves.length < 2;
  const canReopenRematch =
    !!gameOver &&
    gameOverModalDismissed &&
    isPlayer &&
    !gameMeta?.cageMatchId &&
    !gameMeta?.tournamentId &&
    gameOver.reason !== "aborted_no_moves" &&
    gameOver.reason !== "idle_timeout" &&
    gameOver.reason !== "first_move_timeout" &&
    gameOver.reason !== "cage_forfeit";
  const canBerserk =
    isPlayer &&
    status === "active" &&
    !!gameMeta?.tournamentId &&
    !!myColor &&
    !(myColor === "white" ? whiteBerserk : blackBerserk) &&
    (myColor === "white" ? moves.length === 0 : moves.length <= 1);
  const actionItems: any[] = [
    {
      label: boardFlipped ? "Unflip board" : "Flip board",
      icon: FlipVertical,
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
    {
      label: "Settings",
      icon: Settings,
      id: "settings",
      onClick: () => navigate("/settings"),
      danger: false,
    },
    ...(canBerserk
      ? [
          {
            label: "Berserk: halve your clock for a bonus point",
            icon: Swords,
            onClick: handleBerserk,
            danger: true,
            mobilePrimary: true,
          },
        ]
      : []),
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
    ...(gameMeta?.tournamentId
      ? [
          {
            label: "Back to tournament",
            icon: Trophy,
            onClick: () =>
              navigate(`/tournaments/${gameMeta.tournamentId!.code}`),
            danger: false,
          },
        ]
      : []),
    ...(showChat
      ? [
          {
            label: "Spectator chat",
            icon: MessageSquare,
            onClick: () => {
              setChatSheetOpen(true);
              setChatHasUnread(false);
            },
            danger: false,
            mobilePrimary: true,
            dot: chatHasUnread,
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

  // Mobile pill: Flip board, Share, Prev/Next move, and Spectator chat (when
  // present) stay always visible, they're the ones reached for constantly
  // mid-game. Everything else (resign/draw/abort/pause/forfeit/rematch)
  // collapses into the "More" dropup so the pill doesn't sprawl across a
  // phone screen. Desktop is untouched, it still renders the full
  // actionItems list as-is in the right panel.
  const mobilePrimaryItems = [
    ...actionItems.filter((item) => item.mobilePrimary),
  ];
  const mobileOverflowItems = actionItems.filter((item) => !item.mobilePrimary);

  return (
    <div className="relative mx-auto md:min-h-[calc(100dvh-7rem)] flex max-w-6xl flex-col justify-center gap-2 md:gap-3 md:pb-2">
      <GameNotificationsOverlay
        pausedLeg={pausedLeg}
        gameOver={!!gameOver}
        isPlayer={isPlayer}
        moveError={moveError}
        isCageMatch={!!gameMeta?.cageMatchId}
        resumeRequestSent={resumeRequestSent}
        onResumeRequest={handleResumeRequest}
        disconnectExpiresAt={disconnectExpiresAt}
        isIdlePhase={isIdlePhase}
        onClaim={handleClaim}
      />

      {/* Main layout, a plain top-to-bottom stack on phone (details, board,
       *  panels flanking it top/bottom), becoming a CSS grid from md up
       *  (see .game-grid in index.css): a 2-column board/right-panel grid
       *  with the details+moves block spanning full width above it on
       *  tablet, and a 3-column details/board/right-panel grid on desktop,
       *  where the board's grid column is the widest of the three so it
       *  reads as visually larger than the side panels. */}
      <div className="game-grid min-h-0 flex-1">
        {/* Game details, code, share, badges, status, and the move list.
         *  (Spectator chat's trigger now lives in the action button row.)
         *  Left column on desktop; a full-width strip above the board/panel
         *  row on tablet and phone. */}
        <div className="game-area-leftinfo md:px-0 px-5 flex shrink-0 flex-col justify-center gap-3 lg:h-full lg:min-h-0">
          <GameDetailsCard
            badges={badges}
            code={code}
            onShare={handleShareGame}
            zenMode={settings.zenMode}
            spectatorCount={spectatorCount}
            moveListEntries={moveListEntries}
            moveStripEntries={moveStripEntries}
            moveListScrollRef={moveListScrollRef}
            resultSummary={resultSummary}
          />
        </div>

        <GameBoardArea
          opponentPanelData={opponentPanelData}
          myPanelData={myPanelData}
          boardTheme={settings.boardTheme}
          pieceTheme={settings.pieceTheme}
          displayFen={displayFen}
          boardFlipped={boardFlipped}
          myColor={myColor}
          viewOnly={
            !isPlayer || status !== "active" || pausedLeg || isViewingHistory
          }
          turnColor={chess.turn() === "w" ? "white" : "black"}
          dests={dests}
          premoveDests={premoveDests}
          inCheck={inCheck}
          displayLastMove={displayLastMove}
          onUserMove={handleUserMove}
          animationEnabled={settings.pieceAnimation}
          animationDurationMs={animationDurationMs}
          showCoordinates={settings.showCoordinates}
          showLegalMoves={settings.showLegalMoves}
          isPlayer={isPlayer}
          status={status}
          onCancelWaitingGame={handleCancelWaitingGame}
          promoPending={promoPending ? true : false}
          onPromotionPick={handlePromotionPick}
        />

        {/* Right panel, tablet & desktop. Player panels, the cage match
         *  scoreboard (if any), then the action buttons (flip/prev/next,
         *  resign/draw/cage-match, spectator chat trigger) pinned to the
         *  bottom via mt-auto. Spectator chat itself opens as a right-side
         *  drawer from here, or a bottom sheet on phone, see the drawer
         *  markup near the end of the component. */}
        <div className="game-area-rightpanel justify-center min-h-0 flex-col gap-3">
          <div>
            <Card variant="solid" className="shrink-0 space-y-2">
              <PlayerPanelRow
                {...(boardFlipped ? myPanelData : opponentPanelData)}
              />

              <PlayerPanelRow
                {...(boardFlipped ? opponentPanelData : myPanelData)}
              />
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
                <GameActionBarDesktop
                  actionItems={actionItems}
                  prevHold={prevHold}
                  nextHold={nextHold}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        {!settings.zenMode && gameMeta?.cageMatchId && (
          <div className="md:hidden pt-2">
            <CageMatchScoreboard
              cageMatchId={gameMeta.cageMatchId}
              legIndex={gameMeta.legIndex ?? 0}
            />
          </div>
        )}

        {/* Mobile action pill, fixed to the bottom of the screen instead of
         *  sitting in normal flow, so it's always reachable without
         *  scrolling. Only the items reached for constantly mid-game (flip
         *  board, share link, spectator chat, prev/next move) stay always
         *  visible; the rest (resign/draw/abort/pause/forfeit/rematch)
         *  collapse into the "More" dropup so the pill stays a fixed,
         *  compact size regardless of game state. */}
        <GameActionBarMobile
          primaryItems={mobilePrimaryItems}
          overflowItems={mobileOverflowItems}
          prevHold={prevHold}
          nextHold={nextHold}
        />
      </div>

      <GameChatPanel
        show={showChat}
        open={chatSheetOpen}
        onClose={() => setChatSheetOpen(false)}
        messages={chatMessages}
        myUsername={user?.username}
        onSend={handleSendChat}
      />

      {gameOver && !gameOverModalDismissed && (
        <GameOverModal
          result={gameOver.result}
          reason={gameOver.reason}
          myColor={myColor}
          isPlayer={isPlayer}
          canRematch={
            isPlayer &&
            !gameMeta?.cageMatchId &&
            !gameMeta?.tournamentId &&
            gameOver.reason !== "aborted_no_moves" &&
            gameOver.reason !== "idle_timeout" &&
            gameOver.reason !== "first_move_timeout" &&
            gameOver.reason !== "cage_forfeit"
          }
          rematchState={rematchState}
          wagerSettlement={gameOver.wagerSettlement}
          ratingUpdate={
            isPlayer && myColor && gameOver.ratingUpdate
              ? gameOver.ratingUpdate[myColor]
              : null
          }
          myUserId={user?.id}
          onRematch={handleRematch}
          onClose={() => setGameOverModalDismissed(true)}
        />
      )}
    </div>
  );
}
