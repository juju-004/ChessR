import type { ReactNode } from "react";
import { Card, CardContent } from "./Card.js";

/**
 * "What this page does" card. Pages show it only when every other card on
 * them is empty, so a brand-new user lands on an explanation instead of a
 * stack of "None right now" boxes.
 */
export function DescriptionCard({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card variant="solid">
      <CardContent className="space-y-1.5 py-4 text-sm text-base-content/60">
        <p className="font-medium text-base-content">{title}</p>
        {children}
      </CardContent>
    </Card>
  );
}
