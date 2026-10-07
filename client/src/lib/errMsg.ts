import { ApiRequestError } from "../api/http.js";

/** Best human-readable message for a failed API call. Server validation
 *  errors arrive as a generic "Validation failed" with the real, per-field
 *  messages in `details`, so prefer the first of those. */
export function errMsg(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const d = err.details;
    if (d && typeof d === "object") {
      const first = Object.values(d as Record<string, unknown>)
        .flat()
        .find((v): v is string => typeof v === "string");
      if (first) return first;
    }
    return err.message;
  }
  return "Something went wrong. Try again.";
}
