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

interface PocketBarProps {
  color: "white" | "black";
  pocket: Pocket;
  pieceTheme: string;
  /** True only for the viewing player's own pocket while a drop is possible. */
  interactive: boolean;
  selectedRole: ZhRole | null;
  onPiecePointerDown: (role: ZhRole, e: ReactPointerEvent<HTMLElement>) => void;
}

/** One side's pocket ("pieces in hand"). The row's height is fixed so an
 *  empty pocket and a full one occupy the same space and the board never
 *  jumps when a piece is captured or dropped. */
export function PocketBar({
  color,
  pocket,
  pieceTheme,
  interactive,
  selectedRole,
  onPiecePointerDown,
}: PocketBarProps) {
  const held = ZH_ROLES.filter((r) => pocket[r] > 0);
  return (
    <div
      className={cn(
        `piece-theme-${pieceTheme}`,
        "flex h-12 w-full items-center gap-1.5 rounded-xl bg-base-200/60 px-2",
      )}
      aria-label={`${color} pocket`}
    >
      {held.length === 0 ? (
        <span className="text-xs text-base-content/40">
          {color === "white" ? "White" : "Black"} pocket is empty
        </span>
      ) : (
        held.map((role) => {
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
                "relative h-10 w-10 shrink-0 select-none rounded-lg",
                interactive
                  ? "cursor-grab touch-none active:cursor-grabbing"
                  : "opacity-80",
                selected && "bg-primary/20 ring-2 ring-primary",
              )}
            >
              <PocketPiece role={role} color={color} className="h-full w-full" />
              {pocket[role] > 1 && (
                <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 min-w-4 rounded-full bg-base-content px-1 text-center text-[10px] font-bold leading-4 tabular-nums text-base-100">
                  {pocket[role]}
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const DRAG_THRESHOLD_PX = 6;

interface DropControllerArgs {
  /** The element whose box is exactly the 8x8 board. */
  boardRef: RefObject<HTMLElement | null>;
  orientation: "white" | "black";
  /** The LIVE position (never a history position): drops are only ever
   *  made against it. */
  liveFen: string;
  canDrop: boolean;
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
        ? new Set(legalDropSquares(liveFen, activeRole))
        : new Set<string>(),
    [canDrop, activeRole, liveFen],
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
}: {
  orientation: "white" | "black";
  legalSquares: Set<string>;
  captureTaps: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  if (legalSquares.size === 0 && !captureTaps) return null;
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
            <span className="h-[30%] w-[30%] rounded-full bg-black/30" />
          </span>
        );
      })}
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
