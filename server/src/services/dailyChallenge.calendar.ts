/** Calendar-day helpers for the daily challenges. A "day" is a calendar day in
 *  a given time zone, written as a YYYY-MM-DD key. Pure (no env/DB) so it can
 *  be tested on its own. */
export function createCalendar(timeZone: string) {
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const clockFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  /** The calendar day an instant falls on in this time zone. */
  const dateKeyOf = (ms: number): string => dayFormat.format(new Date(ms));

  /** A day key moved by n days (negative = earlier). */
  const addDays = (key: string, n: number): string => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };

  /** Milliseconds until this time zone's next midnight (never below 1s). */
  const msUntilNextDay = (now: number): number => {
    const parts = Object.fromEntries(clockFormat.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
    const secondsIntoDay = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
    return Math.max(1000, (24 * 3600 - secondsIntoDay) * 1000 - (now % 1000));
  };

  return { dateKeyOf, addDays, msUntilNextDay };
}
