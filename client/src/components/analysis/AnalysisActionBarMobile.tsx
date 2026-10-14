import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowLeftCircle, FlipVertical, ListOrdered } from "lucide-react";

/**
 * Phone-only bottom docker for the analysis page, same pattern as the game
 * and tournament pages: back, flip the board, and the button that opens
 * the details drawer (summary + move list). The normal MobileDock steps
 * aside on this route (see Sidebar.tsx).
 */
export function AnalysisActionBarMobile({
  onFlip,
  onOpenDetails,
  backTo = "/analysis",
}: {
  onFlip: () => void;
  onOpenDetails: () => void;
  backTo?: string;
}) {
  const navigate = useNavigate();

  function handleBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1);
    else navigate(backTo);
  }

  return createPortal(
    <nav aria-label="Analysis actions" className="docker game flex md:hidden">
      <button type="button" aria-label="Back" className="docker-item docker-item-grow" onClick={handleBack}>
        <ArrowLeftCircle className="h-5 w-5 text-primary" />
      </button>
      <button type="button" aria-label="Flip board" className="docker-item docker-item-grow" onClick={onFlip}>
        <FlipVertical className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="Moves and summary"
        className="docker-item docker-item-grow"
        onClick={onOpenDetails}
      >
        <ListOrdered className="h-5 w-5" />
      </button>
    </nav>,
    document.body,
  );
}
