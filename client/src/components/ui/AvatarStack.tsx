import { Avatar } from "./Avatar.js";
import { cn } from "@/lib/cn.js";

export interface AvatarStackPlayer {
  username: string;
  avatarGradient?: string | null;
}

/** Overlapping avatars for "these people are in this thing" (a game's two
 *  players, a race's racers). Shows at most `max`, then a "+N" chip. */
export function AvatarStack({
  players,
  max = 4,
  className,
}: {
  players: AvatarStackPlayer[];
  max?: number;
  className?: string;
}) {
  const shown = players.slice(0, max);
  const extra = players.length - shown.length;
  return (
    <div className={cn("flex shrink-0 -space-x-2", className)}>
      {shown.map((p) => (
        <Avatar
          key={p.username}
          username={p.username}
          gradient={p.avatarGradient}
          size="sm"
          className="rounded-full ring-2 ring-base-100"
        />
      ))}
      {extra > 0 && (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-base-300 text-xs font-medium text-base-content/70 ring-2 ring-base-100">
          +{extra}
        </span>
      )}
    </div>
  );
}
