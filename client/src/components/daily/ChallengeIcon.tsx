import {
  Coins,
  Crown,
  Flame,
  Puzzle,
  Swords,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ChallengeIcon as IconKey } from "../../api/dailyChallenges.js";

const ICONS: Record<IconKey, LucideIcon> = {
  swords: Swords,
  trophy: Trophy,
  puzzle: Puzzle,
  users: Users,
  crown: Crown,
  flame: Flame,
  coins: Coins,
  zap: Zap,
  target: Target,
};

export function ChallengeIcon({ icon, className }: { icon: IconKey; className?: string }) {
  const Icon = ICONS[icon] ?? Target;
  return <Icon className={className} />;
}
