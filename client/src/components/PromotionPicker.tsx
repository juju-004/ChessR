interface PromotionPickerProps {
  onPick: (piece: 'q' | 'r' | 'b' | 'n') => void;
}

const PIECES: Array<{ key: 'q' | 'r' | 'b' | 'n'; label: string }> = [
  { key: 'q', label: '♛ Queen' },
  { key: 'r', label: '♜ Rook' },
  { key: 'b', label: '♝ Bishop' },
  { key: 'n', label: '♞ Knight' },
];

export function PromotionPicker({ onPick }: PromotionPickerProps) {
  return (
    <div className="absolute top-1/2 left-1/2 z-10 w-40 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-base-300 bg-base-300 p-3 shadow-xl">
      {PIECES.map((p) => (
        <button
          key={p.key}
          onClick={() => onPick(p.key)}
          className="mb-1 block w-full rounded-md bg-base-300 px-3 py-2 text-left text-sm text-base-content last:mb-0 hover:bg-base-300"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
