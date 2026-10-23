/**
 * Formats an ISO date string or Date object into a human-readable relative/absolute string.
 *
 * Output formats:
 * - < 1 min:   "Just now"
 * - < 1 hr:    "X mins ago"
 * - Today:     "Today at 12:03am"
 * - Yesterday: "Yesterday at 12:03am"
 * - Older:     "MM/DD/YYYY at 12:03am"
 */
export function formatRelativeTime(
  dateInput: string | Date | null | undefined,
): string {
  if (!dateInput) return "";

  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return ""; // Invalid date handling

  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInMins = Math.floor(diffInMs / (1000 * 60));

  // Format time portion (e.g., "12:03am")
  const timeStr = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();

  // 1. Less than 1 minute
  if (diffInMins < 1 && diffInMs >= 0) {
    return "Just now";
  }

  // 2. Less than 60 minutes
  if (diffInMins < 60 && diffInMs >= 0) {
    return `${diffInMins} min${diffInMins === 1 ? "" : "s"} ago`;
  }

  // Helper date normalization
  const isSameDay = (d1: Date, d2: Date): boolean =>
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  // 3. Today
  if (isSameDay(date, now)) {
    return `Today at ${timeStr}`;
  }

  // 4. Yesterday
  if (isSameDay(date, yesterday)) {
    return `Yesterday at ${timeStr}`;
  }

  // 5. Older dates: MM/DD/YYYY at 12:03am
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();

  return `${month}/${day}/${year} at ${timeStr}`;
}

/**
 * Copies text to the user's clipboard.
 *
 * @param text - The string to copy.
 * @returns Promise<boolean> - Returns true if successful, false otherwise.
 */
export async function copyToClipboard(text: string) {
  if (!text) return false;

  // Modern Clipboard API
  if (navigator?.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error("Failed to copy using Clipboard API:", err);
    }
  }
}

/**
 * Pulls a game join code out of free-form input on the dashboard's "join"
 * field, a bare code ("7K3M9P"), a pasted game link
 * ("https://chessr.org/7K3M9P", "chessr.org/7K3M9P/", "/7K3M9P?ref=1", or
 * the legacy "https://chessr.org/game/7K3M9P"), or anything in between.
 * Returns the extracted code with its case untouched (codes are
 * case-sensitive), or "" if there's nothing usable to join with.
 */
export function extractGameCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Drop a query string/hash and any trailing slash first, so
  // ".../7K3M9P?ref=1" and ".../7K3M9P/" resolve the same way as the bare
  // code below.
  const withoutQuery = trimmed.split(/[?#]/)[0].replace(/\/+$/, "");

  // The code is the last path segment, which covers the current
  // ".../7K3M9P" link and the legacy ".../game/7K3M9P" one alike (or, if
  // this wasn't a link at all, the whole input). Keep only alphanumerics.
  const lastSegment = withoutQuery.split("/").pop() ?? withoutQuery;
  // Join codes are case-sensitive (mixed-case letters + digits), so the
  // case is kept exactly as typed.
  return lastSegment.replace(/[^a-zA-Z0-9]/g, "");
}
