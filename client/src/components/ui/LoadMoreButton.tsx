import { Button } from "./Button.js";

/** "Load more" under an append-style list. Renders nothing when there's
 *  nothing more to load. */
export function LoadMoreButton({
  hasMore,
  loading = false,
  onClick,
}: {
  hasMore: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <Button variant="ghost" size="sm" fullWidth loading={loading} onClick={onClick}>
      Load more
    </Button>
  );
}
