/**
 * The daily challenges: what they are, how each day is built, and what each
 * day pays. Pure data and rules, no database, so it is easy to read, tune and
 * test. The engine that tracks progress is dailyChallenge.service.ts.
 *
 * HOW A WEEK WORKS
 *   Seven days, three challenges a day. Finish all three on a calendar day and
 *   that day's reward is paid. The next calendar day unlocks the next day of
 *   the week, which is harder and pays more. Miss a calendar day and the week
 *   starts over at Day 1, so the big rewards at the end go to people who
 *   never skipped. Finish Day 7 and a new week begins the day after.
 *
 * MONEY: an R token is worth real money here (bought and withdrawn at the
 * same naira rate, see wallet.service.ts), so DAY_REWARDS are a real cost to
 * the platform. Tune them with that in mind.
 */

// --- Tuning ------------------------------------------------------------------
/** Paid when that day of the week is completed. Day 1 first. A full week pays
 *  exactly 200 R (= N1,000 at the N5-per-R rate): Days 1-5 climb by 4 R
 *  (6, 10, 14, 18, 22 = 70 R), Day 6 pays 30 R and Day 7 pays 100 R, so the
 *  big money goes to people who never skipped a day. */
export const DAY_REWARDS = [6, 10, 14, 18, 22, 30, 100];
/** Optional extra paid on top of Day 7's reward for finishing the whole week.
 *  0 = off (Day 7's reward already is the big prize). */
export const WEEK_BONUS = 0;
/** A game only counts toward a challenge if it lasted at least this many
 *  plies (half-moves). Stops two accounts farming "play a game" by
 *  resigning on move one. */
export const MIN_GAME_PLIES = 10;
/** Stake floor, mirrors game.controller.ts / the client's lib/limits.ts. */
const MIN_STAKE = 20;

// --- Events ------------------------------------------------------------------
export type DailyEventType =
  | 'game_finished'
  | 'puzzle_solved'
  | 'puzzle_race_joined'
  | 'puzzle_race_finished'
  | 'tournament_joined'
  | 'cage_match_started'
  | 'friend_request_sent'
  | 'challenge_sent';

/** Something a player just did. One flat shape; each type fills the fields
 *  that make sense for it. */
export interface DailyEvent {
  type: DailyEventType;
  /** Makes recording idempotent: the same key is only ever counted once a
   *  day, so a retried or double-fired hook can't double-count. */
  key?: string;
  // game_finished
  result?: 'win' | 'loss' | 'draw';
  wagerTokens?: number;
  variant?: 'standard' | 'chess960' | 'crazyhouse';
  category?: 'bullet' | 'blitz' | 'rapid';
  endReason?: string | null;
  // puzzle_race_finished
  won?: boolean;
  completed?: boolean;
}

// --- Challenge definitions -----------------------------------------------------
export type ChallengeIcon =
  | 'swords'
  | 'trophy'
  | 'puzzle'
  | 'users'
  | 'crown'
  | 'flame'
  | 'coins'
  | 'zap'
  | 'target';

export interface ChallengeDef {
  id: string;
  title: string;
  type: DailyEventType;
  target: number;
  /** Which events of `type` count. Omit to count them all. */
  test?: (e: DailyEvent) => boolean;
  /** "N wins in a row": progress is the best run today, not a running total. */
  streak?: boolean;
  /** Only offered when the player can actually do it. */
  needs?: { minBalance?: number; openTournament?: boolean };
  /** Where the "Go" button on the challenge takes the player. */
  link: string;
  icon: ChallengeIcon;
}

const isWin = (e: DailyEvent) => e.result === 'win';
const isWagered = (e: DailyEvent) => (e.wagerTokens ?? 0) > 0;

function def(d: ChallengeDef): [string, ChallengeDef] {
  return [d.id, d];
}

export const CATALOG: Record<string, ChallengeDef> = Object.fromEntries([
  // --- playing games
  def({ id: 'play_1', title: 'Play a game', type: 'game_finished', target: 1, link: '/lobby', icon: 'swords' }),
  def({ id: 'play_3', title: 'Play 3 games', type: 'game_finished', target: 3, link: '/lobby', icon: 'swords' }),
  def({
    id: 'play_blitz_1',
    title: 'Play a blitz game',
    type: 'game_finished',
    target: 1,
    test: (e) => e.category === 'blitz',
    link: '/lobby',
    icon: 'zap',
  }),
  def({
    id: 'play_960_1',
    title: 'Play a Chess960 game',
    type: 'game_finished',
    target: 1,
    test: (e) => e.variant === 'chess960',
    link: '/lobby',
    icon: 'swords',
  }),

  // --- winning games
  def({ id: 'win_1', title: 'Win a game', type: 'game_finished', target: 1, test: isWin, link: '/lobby', icon: 'crown' }),
  def({ id: 'win_2', title: 'Win 2 games', type: 'game_finished', target: 2, test: isWin, link: '/lobby', icon: 'crown' }),
  def({ id: 'win_3', title: 'Win 3 games', type: 'game_finished', target: 3, test: isWin, link: '/lobby', icon: 'crown' }),
  def({ id: 'win_4', title: 'Win 4 games', type: 'game_finished', target: 4, test: isWin, link: '/lobby', icon: 'crown' }),
  def({
    id: 'win_blitz_1',
    title: 'Win a blitz game',
    type: 'game_finished',
    target: 1,
    test: (e) => isWin(e) && e.category === 'blitz',
    link: '/lobby',
    icon: 'zap',
  }),
  def({
    id: 'win_by_mate',
    title: 'Win a game by checkmate',
    type: 'game_finished',
    target: 1,
    test: (e) => isWin(e) && e.endReason === 'checkmate',
    link: '/lobby',
    icon: 'target',
  }),
  def({
    id: 'win_streak_2',
    title: 'Win 2 games in a row',
    type: 'game_finished',
    target: 2,
    streak: true,
    link: '/lobby',
    icon: 'flame',
  }),
  def({
    id: 'win_streak_3',
    title: 'Win 3 games in a row',
    type: 'game_finished',
    target: 3,
    streak: true,
    link: '/lobby',
    icon: 'flame',
  }),

  // --- wagered games (only offered to players who can cover the stakes)
  def({
    id: 'play_wagered_1',
    title: 'Play a wagered game',
    type: 'game_finished',
    target: 1,
    test: isWagered,
    needs: { minBalance: MIN_STAKE },
    link: '/lobby',
    icon: 'coins',
  }),
  def({
    id: 'play_wagered_2',
    title: 'Play 2 wagered games',
    type: 'game_finished',
    target: 2,
    test: isWagered,
    needs: { minBalance: MIN_STAKE * 2 },
    link: '/lobby',
    icon: 'coins',
  }),
  def({
    id: 'play_wagered_3',
    title: 'Play 3 wagered games',
    type: 'game_finished',
    target: 3,
    test: isWagered,
    needs: { minBalance: MIN_STAKE * 3 },
    link: '/lobby',
    icon: 'coins',
  }),
  def({
    id: 'win_wagered_1',
    title: 'Win a wagered game',
    type: 'game_finished',
    target: 1,
    test: (e) => isWin(e) && isWagered(e),
    needs: { minBalance: MIN_STAKE },
    link: '/lobby',
    icon: 'coins',
  }),
  def({
    id: 'win_wagered_2',
    title: 'Win 2 wagered games',
    type: 'game_finished',
    target: 2,
    test: (e) => isWin(e) && isWagered(e),
    needs: { minBalance: MIN_STAKE * 2 },
    link: '/lobby',
    icon: 'coins',
  }),
  def({
    id: 'high_stake_1',
    title: 'Play a game with a 100 R stake or more',
    type: 'game_finished',
    target: 1,
    test: (e) => (e.wagerTokens ?? 0) >= 100,
    needs: { minBalance: 100 },
    link: '/lobby',
    icon: 'coins',
  }),

  // --- puzzle races
  def({ id: 'join_race', title: 'Join a puzzle race', type: 'puzzle_race_joined', target: 1, link: '/puzzles', icon: 'puzzle' }),
  def({
    id: 'join_wagered_race',
    title: 'Join a wagered puzzle race',
    type: 'puzzle_race_joined',
    target: 1,
    test: isWagered,
    needs: { minBalance: MIN_STAKE },
    link: '/puzzles',
    icon: 'coins',
  }),
  def({ id: 'solve_3', title: 'Solve 3 puzzles in races', type: 'puzzle_solved', target: 3, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_5', title: 'Solve 5 puzzles in races', type: 'puzzle_solved', target: 5, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_8', title: 'Solve 8 puzzles in races', type: 'puzzle_solved', target: 8, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_10', title: 'Solve 10 puzzles in races', type: 'puzzle_solved', target: 10, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_15', title: 'Solve 15 puzzles in races', type: 'puzzle_solved', target: 15, link: '/puzzles', icon: 'puzzle' }),
  def({
    id: 'complete_race',
    title: 'Solve every puzzle in a race',
    type: 'puzzle_race_finished',
    target: 1,
    test: (e) => !!e.completed,
    link: '/puzzles',
    icon: 'puzzle',
  }),
  def({
    id: 'complete_wagered_race',
    title: 'Solve every puzzle in a wagered race',
    type: 'puzzle_race_finished',
    target: 1,
    test: (e) => !!e.completed && isWagered(e),
    needs: { minBalance: MIN_STAKE },
    link: '/puzzles',
    icon: 'coins',
  }),
  def({
    id: 'win_race',
    title: 'Win a puzzle race',
    type: 'puzzle_race_finished',
    target: 1,
    test: (e) => !!e.won,
    link: '/puzzles',
    icon: 'trophy',
  }),
  def({
    id: 'win_wagered_race',
    title: 'Win a wagered puzzle race',
    type: 'puzzle_race_finished',
    target: 1,
    test: (e) => !!e.won && isWagered(e),
    needs: { minBalance: MIN_STAKE },
    link: '/puzzles',
    icon: 'trophy',
  }),

  // --- around the app
  def({
    id: 'join_tournament',
    title: 'Join a tournament',
    type: 'tournament_joined',
    target: 1,
    needs: { openTournament: true },
    link: '/tournaments',
    icon: 'trophy',
  }),
  def({ id: 'friend_request', title: 'Follow a player', type: 'friend_request_sent', target: 1, link: '/players', icon: 'users' }),
  def({ id: 'challenge_send', title: 'Challenge a player to a game', type: 'challenge_sent', target: 1, link: '/players', icon: 'swords' }),
  def({ id: 'start_cage', title: 'Start a cage match', type: 'cage_match_started', target: 1, link: '/cage', icon: 'swords' }),
]);

/**
 * The week. SCHEDULE[day - 1][slot] is the list of challenges that slot can
 * be on that day; one is picked per player (see pickChallenges). Offering a
 * choice lets a slot adapt: a player with no coins is never handed a wagered
 * challenge, and nobody is handed "join a tournament" when none is open.
 * Every slot must contain at least one challenge with no `needs`, which
 * assertCatalog() below enforces.
 *
 * Difficulty climbs: Day 1 is a single game; Day 7 is several wins, a win
 * streak or a wagered win.
 */
export const SCHEDULE: string[][][] = [
  // Day 1
  [['play_1', 'play_blitz_1'], ['join_race', 'friend_request'], ['challenge_send', 'join_tournament']],
  // Day 2
  [['win_1', 'play_960_1'], ['solve_3', 'join_tournament'], ['play_3', 'challenge_send']],
  // Day 3: first wager
  [['play_wagered_1', 'win_2'], ['solve_5', 'complete_race'], ['play_3', 'win_blitz_1']],
  // Day 4
  [['play_wagered_2', 'win_2'], ['join_wagered_race', 'join_tournament', 'solve_5'], ['win_by_mate', 'start_cage']],
  // Day 5
  [['play_wagered_3', 'win_wagered_1', 'win_3'], ['solve_8', 'win_race'], ['win_streak_2', 'win_by_mate']],
  // Day 6
  [['play_wagered_3', 'high_stake_1', 'win_3'], ['win_race', 'complete_wagered_race', 'solve_10'], ['win_3', 'win_streak_2']],
  // Day 7: the hardest
  [['win_wagered_2', 'win_4'], ['win_wagered_race', 'solve_15', 'win_race'], ['win_streak_3', 'win_4']],
];

/** Fails loudly at startup if the schedule references a missing challenge or
 *  a slot could leave a player with nothing they can do. */
export function assertCatalog(): void {
  if (SCHEDULE.length !== 7 || DAY_REWARDS.length !== 7) throw new Error('daily challenges: need exactly 7 days');
  SCHEDULE.forEach((day, d) => {
    if (day.length !== 3) throw new Error(`daily challenges: day ${d + 1} needs exactly 3 slots`);
    day.forEach((pool, s) => {
      for (const id of pool) if (!CATALOG[id]) throw new Error(`daily challenges: unknown challenge "${id}"`);
      if (!pool.some((id) => !CATALOG[id].needs)) {
        throw new Error(`daily challenges: day ${d + 1} slot ${s + 1} has no challenge anyone can do`);
      }
    });
  });
}
assertCatalog();

// --- Picking a day's three -------------------------------------------------------
export interface PickContext {
  balance: number;
  openTournament: boolean;
}

function isAvailable(d: ChallengeDef, ctx: PickContext): boolean {
  if (d.needs?.minBalance !== undefined && ctx.balance < d.needs.minBalance) return false;
  if (d.needs?.openTournament && !ctx.openTournament) return false;
  return true;
}

/** Small stable string hash (FNV-1a), so the same player gets the same set
 *  all day but different players, and different weeks, get different mixes. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pickChallenges(userId: string, cycle: number, day: number, ctx: PickContext): string[] {
  const chosen: string[] = [];
  SCHEDULE[day - 1].forEach((pool, slot) => {
    let options = pool.filter((id) => isAvailable(CATALOG[id], ctx) && !chosen.includes(id));
    if (options.length === 0) {
      // Always exists thanks to assertCatalog (unless an earlier slot took it).
      options = pool.filter((id) => !CATALOG[id].needs && !chosen.includes(id));
    }
    if (options.length === 0) options = pool.filter((id) => !CATALOG[id].needs);
    chosen.push(options[hash(`${userId}:${cycle}:${day}:${slot}`) % options.length]);
  });
  return chosen;
}

/** Does this event count toward this challenge, and by how much (always 1)? */
export function eventCounts(d: ChallengeDef, e: DailyEvent): boolean {
  return d.type === e.type && (d.test ? d.test(e) : true);
}
