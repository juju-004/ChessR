import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { cn } from "../../lib/cn.js";
import {
  ZH_ROLES,
  legalDropSquares,
  parseZhFen,
  type Pocket,
  type ZhRole,
} from "../../crazyhouse.js";

const ROLE_NAME: Record<ZhRole, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
};

/** A single piece drawn with the active piece theme. Uses the same
 *  `piece.<role>.<color>` rules chessground's own pieces use (all scoped
 *  under `.piece-theme-x .cg-wrap`), so every theme works with no extra
 *  CSS. Must sit under an element carrying `piece-theme-<name>`. */
export function PocketPiece({
  role,
  color,
  className,
}: {
  role: ZhRole;
  color: "white" | "black";
  className?: string;
}) {
  return (
    <span className={cn("cg-wrap block", className)}>
      {createElement("piece", {
        className: `${ROLE_NAME[role]} ${color}`,
        style: {
          position: "relative",
          display: "block",
          width: "100%",
          height: "100%",
          transform: "none",
          pointerEvents: "none",
        },
      })}
    </span>
  );
}

const POCKET_BG_FOR_WHITE = "#1c1c1f";
// Softened: a fully opaque near-white tray glared against dark UI.
const POCKET_BG_FOR_BLACK = "rgba(241, 241, 243, 0.55)";

interface PocketBarProps {
  color: "white" | "black";
  pocket: Pocket;
  pieceTheme: string;
  /** The active board theme (no longer drives the tray color; kept so callers
   *  don't change). */
  boardTheme: string;
  /** True only for the viewing player's own pocket while a drop is possible. */
  interactive: boolean;
  selectedRole: ZhRole | null;
  onPiecePointerDown: (role: ZhRole, e: ReactPointerEvent<HTMLElement>) => void;
}

/** One side's pocket ("pieces in hand"). The row's height is fixed so the
 *  board never jumps when a piece is captured or dropped; its width has a
 *  minimum and expands as more piece types are held (max 5 types, so it
 *  never outgrows the board). An empty pocket is just the blank tray.
 *
 *  Visibility: the backdrop is the OPPOSITE color of the pieces it holds,
 *  white pieces sit on a near-black tray and black pieces on a near-white
 *  one. Every piece set is drawn to read against its opposite color, so this
 *  holds for every piece set x board theme x app light/dark mode without any
 *  per-set special-casing. */
export function PocketBar({
  color,
  pocket,
  pieceTheme,
  boardTheme,
  interactive,
  selectedRole,
  onPiecePointerDown,
}: PocketBarProps) {
  const held = ZH_ROLES.filter((r) => pocket[r] > 0);
  // White pieces go on a dark tray, black pieces on a light one.
  const onDark = color === "white";
  return (
    <div
      className={cn(
        `piece-theme-${pieceTheme}`,
        `board-theme-${boardTheme}`,
        // Fixed height, but width hugs the pieces: a floor so an empty or
        // near-empty pocket still reads as a tray, growing as pieces arrive.
        "flex h-12 w-fit min-w-36 max-w-full items-center gap-1.5 rounded-xl px-2",
      )}
      style={{
        backgroundColor: onDark ? POCKET_BG_FOR_WHITE : POCKET_BG_FOR_BLACK,
      }}
      aria-label={`${color} pocket`}
    >
      {held.map((role) => {
        const selected = interactive && selectedRole === role;
        return (
          <div
            key={role}
            role={interactive ? "button" : undefined}
            aria-label={`${ROLE_NAME[role]} x${pocket[role]}`}
            onPointerDown={
              interactive ? (e) => onPiecePointerDown(role, e) : undefined
            }
            className={cn(
              // `isolate` gives each tile its own stacking context: the
              // piece element carries chessground's `z-index: 2`, so the
              // count badge below needs an explicit z-index above it or
              // it paints underneath the piece.
              "relative isolate h-10 w-10 shrink-0 select-none rounded-lg",
              interactive && "cursor-grab touch-none active:cursor-grabbing",
              selected &&
                (onDark ? "bg-white/25" : "bg-black/15") +
                  " ring-2 ring-primary",
            )}
          >
            <PocketPiece role={role} color={color} className="h-full w-full" />
            {pocket[role] > 1 && (
              <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 z-10 min-w-4 rounded-full bg-base-content px-1 text-center text-[10px] leading-4 font-bold tabular-nums text-base-100 shadow-sm">
                {pocket[role]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Squares a piece may be PREMOVED onto while it's the opponent's turn: every
 *  empty square (no pawns on the back ranks). Real legality (check, a square
 *  the opponent just took) can only be judged once their move lands, so the
 *  drop is re-validated then and quietly dropped if it no longer works. */
function premoveDropSquares(fen: string, role: ZhRole): Set<string> {
  const placement = parseZhFen(fen).clean.split(" ")[0];
  const out = new Set<string>();
  let rank = 8;
  let file = 0;
  for (const ch of placement) {
    if (ch === "/") {
      rank -= 1;
      file = 0;
    } else if (ch >= "1" && ch <= "8") {
      for (let i = 0; i < Number(ch); i++) {
        if (!(role === "p" && (rank === 1 || rank === 8))) {
          out.add(`${"abcdefgh"[file + i]}${rank}`);
        }
      }
      file += Number(ch);
    } else {
      file += 1;
    }
  }
  return out;
}

const DRAG_THRESHOLD_PX = 6;

interface DropControllerArgs {
  /** The element whose box is exactly the 8x8 board. */
  boardRef: RefObject<HTMLElement | null>;
  orientation: "white" | "black";
  /** The LIVE position (never a history position): drops are only ever
   *  made against it. */
  liveFen: string;
  /** True while a piece may be picked up (a real drop, or a premove). */
  canDrop: boolean;
  /** True when that is a premove: it's the opponent's turn. */
  premoveMode?: boolean;
  onDrop: (role: ZhRole, square: string) => void;
}

/** Owns the "I picked a piece from my pocket" interaction: tap a piece to
 *  select it (legal squares light up, then tap a square), or press and
 *  drag it straight onto the board. Chessground only knows how to move
 *  pieces that are already on the board, so this lives beside it rather
 *  than inside it, and hit-tests squares from the board's own rectangle. */
export function useDropController({
  boardRef,
  orientation,
  liveFen,
  canDrop,
  premoveMode = false,
  onDrop,
}: DropControllerArgs) {
  const [selectedRole, setSelectedRole] = useState<ZhRole | null>(null);
  const [drag, setDrag] = useState<{ role: ZhRole; x: number; y: number } | null>(
    null,
  );
  const pressRef = useRef<{
    role: ZhRole;
    startX: number;
    startY: number;
    dragging: boolean;
    wasSelected: boolean;
  } | null>(null);

  // Whichever role is currently "in hand" (selected or being dragged)
  // decides which squares are legal.
  const activeRole = drag?.role ?? selectedRole;
  const legalSquares = useMemo(
    () =>
      canDrop && activeRole
        ? premoveMode
          ? premoveDropSquares(liveFen, activeRole)
          : new Set(legalDropSquares(liveFen, activeRole))
        : new Set<string>(),
    [canDrop, premoveMode, activeRole, liveFen],
  );

  // The turn passing (or the position changing under us) cancels a pending
  // selection, a stale one would offer squares that were legal last move.
  useEffect(() => {
    if (!canDrop) {
      setSelectedRole(null);
      setDrag(null);
      pressRef.current = null;
    }
  }, [canDrop]);
  useEffect(() => {
    setSelectedRole(null);
  }, [liveFen]);

  const squareAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const el = boardRef.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      if (
        clientX < box.left ||
        clientX >= box.right ||
        clientY < box.top ||
        clientY >= box.bottom
      ) {
        return null;
      }
      const col = Math.floor(((clientX - box.left) / box.width) * 8);
      const row = Math.floor(((clientY - box.top) / box.height) * 8);
      const file = orientation === "white" ? col : 7 - col;
      const rank = orientation === "white" ? 8 - row : row + 1;
      return `${"abcdefgh"[file]}${rank}`;
    },
    [boardRef, orientation],
  );

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const legalRef = useRef(legalSquares);
  legalRef.current = legalSquares;

  const handlePocketPointerDown = useCallback(
    (role: ZhRole, e: ReactPointerEvent<HTMLElement>) => {
      if (!canDrop) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      pressRef.current = {
        role,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        wasSelected: selectedRole === role,
      };

      function onMove(ev: PointerEvent) {
        const press = pressRef.current;
        if (!press) return;
        if (!press.dragging) {
          const dx = ev.clientX - press.startX;
          const dy = ev.clientY - press.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          press.dragging = true;
        }
        setDrag({ role: press.role, x: ev.clientX, y: ev.clientY });
      }

      function finish(ev: PointerEvent, cancelled: boolean) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        const press = pressRef.current;
        pressRef.current = null;
        setDrag(null);
        if (!press) return;
        if (press.dragging) {
          setSelectedRole(null);
          if (cancelled) return;
          const sq = squareAt(ev.clientX, ev.clientY);
          if (sq && legalRef.current.has(sq)) onDropRef.current(press.role, sq);
          return;
        }
        // A plain tap: select the piece, or put it back if it was selected.
        if (!cancelled) setSelectedRole(press.wasSelected ? null : press.role);
      }
      function onUp(ev: PointerEvent) {
        finish(ev, false);
      }
      function onCancel(ev: PointerEvent) {
        finish(ev, true);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [canDrop, selectedRole, squareAt],
  );

  /** Pointer-down on the board while a piece is selected: drop it on a
   *  legal square, anything else just cancels the selection. */
  const handleBoardPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!selectedRole) return;
      e.preventDefault();
      e.stopPropagation();
      const sq = squareAt(e.clientX, e.clientY);
      const role = selectedRole;
      setSelectedRole(null);
      if (sq && legalRef.current.has(sq)) onDropRef.current(role, sq);
    },
    [selectedRole, squareAt],
  );

  return {
    selectedRole,
    drag,
    legalSquares,
    handlePocketPointerDown,
    handleBoardPointerDown,
  };
}

/** Dots on every legal drop square, plus (while a piece is selected, not
 *  mid-drag) a transparent layer that catches the tap on the board. */
export function DropOverlay({
  orientation,
  legalSquares,
  captureTaps,
  onPointerDown,
  premoveMode = false,
  premove = null,
}: {
  orientation: "white" | "black";
  legalSquares: Set<string>;
  captureTaps: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Dots use the premove colour while queueing a premove. */
  premoveMode?: boolean;
  /** The drop premove already queued, drawn as a ghost piece. */
  premove?: { role: ZhRole; square: string; color: "white" | "black" } | null;
}) {
  if (legalSquares.size === 0 && !captureTaps && !premove) return null;
  const cell = (sq: string) => {
    const file = "abcdefgh".indexOf(sq[0]);
    const rank = Number(sq[1]);
    const col = orientation === "white" ? file : 7 - file;
    const row = orientation === "white" ? 8 - rank : rank - 1;
    return { left: `${col * 12.5}%`, top: `${row * 12.5}%`, width: "12.5%", height: "12.5%" };
  };
  return (
    <div
      className={cn(
        "absolute inset-0 z-20 touch-none",
        captureTaps ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
      )}
      onPointerDown={captureTaps ? onPointerDown : undefined}
    >
      {[...legalSquares].map((sq) => {
        const file = "abcdefgh".indexOf(sq[0]);
        const rank = Number(sq[1]);
        const col = orientation === "white" ? file : 7 - file;
        const row = orientation === "white" ? 8 - rank : rank - 1;
        return (
          <span
            key={sq}
            className="pointer-events-none absolute flex items-center justify-center"
            style={{
              left: `${col * 12.5}%`,
              top: `${row * 12.5}%`,
              width: "12.5%",
              height: "12.5%",
            }}
          >
            <span
              className={cn(
                "h-[30%] w-[30%] rounded-full",
                premoveMode ? "bg-[rgba(20,30,85,0.5)]" : "bg-black/30",
              )}
            />
          </span>
        );
      })}
      {premove && (
        <span
          className="pointer-events-none absolute flex items-center justify-center"
          style={{ ...cell(premove.square), backgroundColor: "rgba(20,30,85,0.5)" }}
        >
          <PocketPiece
            role={premove.role}
            color={premove.color}
            className="h-full w-full opacity-70"
          />
        </span>
      )}
    </div>
  );
}

/** The piece that follows the pointer while dragging out of a pocket. */
export function DragGhost({
  role,
  color,
  x,
  y,
  size,
  pieceTheme,
}: {
  role: ZhRole;
  color: "white" | "black";
  x: number;
  y: number;
  size: number;
  pieceTheme: string;
}) {
  return (
    <div
      className={cn(`piece-theme-${pieceTheme}`, "pointer-events-none fixed z-50")}
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.35))",
      }}
    >
      <PocketPiece role={role} color={color} className="h-full w-full" />
    </div>
  );
}
