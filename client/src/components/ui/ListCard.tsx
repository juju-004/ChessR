import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./Card.js";
import { CenteredSpinner } from "./CenteredSpinner.js";

export interface ListCardProps {
  title: ReactNode;
  /** Right side of the header: a refresh button, a "View all" link, ... */
  actions?: ReactNode;
  /** True until the first fetch lands. Shows a spinner instead of the
   *  empty message so "nothing yet" never flashes before the real list. */
  loading?: boolean;
  /** Show `emptyMessage` (the rows in `children` are normally none then). */
  empty?: boolean;
  emptyMessage?: ReactNode;
  /** Pagination, a load-more button, ... rendered under the rows. */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * The standard "titled card containing a list" used by the tournaments,
 * cage matches and dashboard pages: header, loading spinner, empty message,
 * rows, footer. One place for how all of those look and behave.
 */
export function ListCard({
  title,
  actions,
  loading = false,
  empty = false,
  emptyMessage,
  footer,
  className,
  children,
}: ListCardProps) {
  return (
    <Card variant="solid" className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <CenteredSpinner />
        ) : (
          <>
            {empty && emptyMessage && (
              <p className="text-sm text-base-content/50">{emptyMessage}</p>
            )}
            {children}
            {footer}
          </>
        )}
      </CardContent>
    </Card>
  );
}
