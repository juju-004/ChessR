import { memo } from "react";
interface PromotionPickerProps {
  onPick: (piece: 'q' | 'r' | 'b' | 'n') => void;
}

const PIECES: Array<{ key: 'q' | 'r' | 'b' | 'n'; label: string; glyph: string }> = [
  { key: 'q', label: 'Queen', glyph: '♛' },
  { key: 'r', label: 'Rook', glyph: '♜' },
  { key: 'b', label: 'Bishop', glyph: '♝' },
  { key: 'n', label: 'Knight', glyph: '♞' },
];

export const PromotionPicker = memo(function PromotionPicker({ onPick }: PromotionPickerProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
      <div className="elevated-strong w-48 rounded-2xl p-3">
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
          Promote to
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PIECES.map((p) => (
            <button
              key={p.key}
              onClick={() => onPick(p.key)}
              className="flex flex-col items-center gap-0.5 rounded-xl bg-base-200 py-3 text-base-content transition-colors hover:bg-(--primary)/15 hover:text-(--primary)"
            >
              <span className="text-3xl leading-none">{p.glyph}</span>
              <span className="text-xs font-medium">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
})
