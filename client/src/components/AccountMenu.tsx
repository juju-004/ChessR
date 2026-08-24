import { useNavigate } from "react-router-dom";
import { ChevronDown, User, Coins, LogOut, Moon, Sun, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.js";
import { useTokenBalance } from "../hooks/useTokenBalance.js";
import { useBalanceVisibility } from "../hooks/useBalanceVisibility.js";
import { logout } from "../api/auth.js";
import { Avatar } from "./ui/Avatar.js";
import { Dropdown, type DropdownItem } from "./ui/Dropdown.js";
import { RCoin } from "./ui/RCoin.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { useTheme } from "@/contexts/ThemeContext.js";

/** Everything account-related — the R Coin balance, profile link, username,
 *  logout — collapsed into a single pill in the navbar. The
 *  balance stays visible at a glance on the trigger itself; the rest lives
 *  behind the dropdown. */
export function AccountMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { balance } = useTokenBalance();
  const { hidden: balanceHidden, toggle: toggleBalanceHidden } = useBalanceVisibility();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  if (!user) return null;

  async function handleLogout() {
    await logout();
    navigate("/signin");
  }

  const items: DropdownItem[] = [
    {
      label: "My profile",
      icon: User,
      onClick: () => navigate(`/profile/${user.username}`),
    },
    {
      label: "Buy R Coins",
      icon: Coins,
      onClick: () => navigate("/wallet/buy"),
    },
    {
      label: isDark ? "Light theme" : "Dark theme",
      icon: isDark ? Sun : Moon,
      onClick: toggleTheme,
      className: "text-base-content/80 md:hidden",
    },
    { label: "Log out", icon: LogOut, danger: true, onClick: handleLogout },
  ];

  return (
    <Dropdown
      align="end"
      header={
        <div className="mb-1 border-b border-base-content/10 pb-1 md:hidden">
          <ConnectionStatus variant="row" />
        </div>
      }
      trigger={
        <button className="elevated flex h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-medium text-base-content transition-colors hover:bg-base-content/5">
          <Avatar
            username={user.username}
            gradient={user.avatarGradient}
            size="xs"
          />
          <span className="hidden sm:inline">{user.username}</span>
          <span className="flex items-center gap-1 rounded-full bg-(--primary)/15 py-0.5 pr-1 pl-2 text-xs font-semibold text-(--primary)">
            <RCoin size={12} />
            {balanceHidden ? (
              <span className="tracking-widest" aria-label="Balance hidden">
                •••
              </span>
            ) : (
              (balance ?? "…")
            )}
            {/* Own click target, stopping propagation so it toggles
             *  visibility instead of also firing the trigger's onClick
             *  (Popover attaches that to a wrapping <span> around the
             *  whole trigger, which would otherwise open the dropdown
             *  every time this is tapped). */}
            <span
              role="button"
              tabIndex={0}
              aria-label={balanceHidden ? "Show balance" : "Hide balance"}
              onClick={(e) => {
                e.stopPropagation();
                toggleBalanceHidden();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleBalanceHidden();
                }
              }}
              className="-mr-0.5 flex h-4 w-4 items-center justify-center rounded-full text-(--primary)/70 transition-colors hover:bg-(--primary)/20 hover:text-(--primary)"
            >
              {balanceHidden ? (
                <Eye className="h-3 w-3" />
              ) : (
                <EyeOff className="h-3 w-3" />
              )}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-base-content/50" />
        </button>
      }
      items={items}
    />
  );
}
