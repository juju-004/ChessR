import { useNavigate } from "react-router-dom";
import { ChevronDown, User, Coins, LogOut } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { logout } from "../api/auth.js";
import { Avatar } from "./ui/Avatar.js";
import { Dropdown, type DropdownItem } from "./ui/Dropdown.js";

/** Everything account-related — token balance, profile link, username,
 *  logout — collapsed into a single glass bubble in the navbar. The
 *  balance stays visible at a glance on the trigger itself; the rest lives
 *  behind the dropdown. */
export function AccountMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { balance } = useTokenBalance();

  if (!user) return null;

  async function handleLogout() {
    await logout();
    navigate("/signin");
  }

  const items: DropdownItem[] = [
    { label: "My profile", icon: User, onClick: () => navigate(`/profile/${user.username}`) },
    { label: "Buy tokens", icon: Coins, onClick: () => navigate("/wallet/buy") },
    { label: "Log out", icon: LogOut, danger: true, onClick: handleLogout },
  ];

  return (
    <Dropdown
      align="end"
      trigger={
        <button className="glass flex h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium text-base-content hover:bg-white/10">
          <Avatar username={user.username} size="xs" />
          <span className="hidden sm:inline">{user.username}</span>
          <span className="hidden items-center gap-1 rounded-full bg-[var(--primary)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--primary)] sm:flex">
            <Coins className="h-3 w-3" />
            {balance ?? "…"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-base-content/50" />
        </button>
      }
      items={items}
    />
  );
}
