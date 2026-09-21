// Shared estimate of (server clock) - (this device's clock), in ms.
//
// The game clock display (PlayerPanels.tsx's computeLiveMs) counts down by
// comparing this device's Date.now() against a timestamp the SERVER
// generated (turnStartedAtMs). That only shows the same number on both
// players' screens if their two system clocks agree with each other — and
// nothing guarantees that. A phone or laptop clock can be off by several
// seconds with the user never noticing, and both players' clients were
// computing remaining time from their own unsynced Date.now() with zero
// correction, so two players mid-game could (and did) see two different
// countdown numbers for the exact same actual position.
//
// ConnectionStatus.tsx already round-trips a ping to the server every 2s
// for the latency indicator, and the server's ack already includes its own
// clock reading (pingSocket.ts's `serverTime`) for exactly this purpose —
// it just wasn't being used. This module gives that existing ping loop
// somewhere to report the offset, and gives the clock display somewhere to
// read it, without running a second, redundant ping loop of its own.
//
// One-shot offset estimate per sample (standard NTP-style calculation):
// assumes the trip to the server and the trip back took about the same
// time, so the server's clock read roughly rtt/2 after we sent, not at
// the moment we received the reply.
const OFFSET_EMA_ALPHA = 0.3; // same smoothing weight as ConnectionStatus's latency EMA, for the same reason: one slow/asymmetric sample shouldn't yank the displayed clock

let offsetMs = 0;
let hasSample = false;

export function recordClockOffsetSample(
  serverTime: number,
  sentAt: number,
  receivedAt: number,
): void {
  const rtt = receivedAt - sentAt;
  const estimate = serverTime + rtt / 2 - receivedAt;
  offsetMs = hasSample ? offsetMs + OFFSET_EMA_ALPHA * (estimate - offsetMs) : estimate;
  hasSample = true;
}

/** Resets to "assume aligned" — call on disconnect so a reconnect doesn't
 *  keep averaging in an offset from before the drop (mirrors
 *  ConnectionStatus resetting its own latency EMA the same way). */
export function resetClockOffset(): void {
  offsetMs = 0;
  hasSample = false;
}

/** Best current estimate of (server time) - (this device's time), in ms.
 *  0 until the first sample arrives, i.e. clocks are assumed aligned until
 *  proven otherwise rather than applying a wild first-guess correction. */
export function getClockOffsetMs(): number {
  return offsetMs;
}

/** this device's Date.now(), corrected to (an estimate of) the server's
 *  clock. Use this instead of a bare Date.now() anywhere remaining time is
 *  computed from a server-issued timestamp (turnStartedAtMs). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
