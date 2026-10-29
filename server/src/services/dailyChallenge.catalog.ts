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
 * No challenge asks a player to stake coins. Difficulty comes from what you
 * have to achieve (win more games, beat higher-rated players, win races, solve
 * hard puzzles), never from what you have to risk.
 *
 * MONEY: an R token is worth real money here (bought and withdrawn at the
 * same naira rate, see wallet.service.ts), so DAY_REWARDS are a real cost to
 * the platform. Tune them with that in mind.
 */

// --- Tuning ------------------------------------------------------------------
/** Paid when that day of the week is completed. Day 1 first. A full week pays
 *  exactly 170 R (= N850 at the N5-per-R rate): Days 1-5 climb by 4 R
 *  (6, 10, 14, 18, 22 = 70 R), Day 6 pays 30 R and Day 7 pays 70 R, so the
 *  big money goes to people who never skipped a day. */
export const DAY_REWARDS = [6, 10, 14, 18, 22, 30, 70];
/** Optional extra paid on top of Day 7's reward for finishing the whole week.
 *  0 = off (Day 7's reward already is the big prize). */
export const WEEK_BONUS = 0;
/** A game only counts toward a challenge if it lasted at least this many
 *  plies (half-moves). Stops two accounts farming "play a game" by
 *  resigning on move one. */
export const MIN_GAME_PLIES = 10;
/** A puzzle counts as "hard" from this rating up. Same cut-off as the `hard`
 *  band in puzzleRace.service.ts (DIFFICULTY_RANGE), so a hard race and a
 *  mixed race both feed the hard-puzzle challenges. */
export const HARD_PUZZLE_RATING = 1500;

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
  /** Opponent's rating minus yours, on this game's rating ladder, as it stood
   *  BEFORE the game. Positive = you played someone higher rated. Missing
   *  when the ratings couldn't be read. */
  opponentRatingGap?: number;
  category?: 'bullet' | 'blitz' | 'rapid';
  endReason?: string | null;
  // puzzle_solved
  puzzleRating?: number;
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
  needs?: {
    /** A tournament anyone can join for free is open right now. */
    openTournament?: boolean;
    /** Somebody is rated above this player, so "higher rated" is possible. */
    higherRated?: boolean;
  };
  /** Where the "Go" button on the challenge takes the player. */
  link: string;
  icon: ChallengeIcon;
}

const isWin = (e: DailyEvent) => e.result === 'win';
const isHigherRated = (e: DailyEvent) => (e.opponentRatingGap ?? 0) > 0;
const isHardPuzzle = (e: DailyEvent) => (e.puzzleRating ?? 0) >= HARD_PUZZLE_RATING;

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

  // --- harder games
  def({
    id: 'win_5',
    title: 'Win 5 games',
    type: 'game_finished',
    target: 5,
    test: isWin,
    link: '/lobby',
    icon: 'crown',
  }),
  def({
    id: 'win_streak_4',
    title: 'Win 4 games in a row',
    type: 'game_finished',
    target: 4,
    streak: true,
    link: '/lobby',
    icon: 'flame',
  }),
  def({
    id: 'win_960_1',
    title: 'Win a Chess960 game',
    type: 'game_finished',
    target: 1,
    test: (e) => isWin(e) && e.variant === 'chess960',
    link: '/lobby',
    icon: 'crown',
  }),
  def({
    id: 'win_960_2',
    title: 'Win 2 Chess960 games',
    type: 'game_finished',
    target: 2,
    test: (e) => isWin(e) && e.variant === 'chess960',
    link: '/lobby',
    icon: 'crown',
  }),

  // --- higher-rated opponents (only offered when someone is rated above you)
  def({
    id: 'play_higher_1',
    title: 'Play a higher-rated opponent',
    type: 'game_finished',
    target: 1,
    test: isHigherRated,
    needs: { higherRated: true },
    link: '/lobby',
    icon: 'target',
  }),
  def({
    id: 'beat_higher_1',
    title: 'Beat a higher-rated opponent',
    type: 'game_finished',
    target: 1,
    test: (e) => isWin(e) && isHigherRated(e),
    needs: { higherRated: true },
    link: '/lobby',
    icon: 'target',
  }),
  def({
    id: 'beat_higher_2',
    title: 'Beat 2 higher-rated opponents',
    type: 'game_finished',
    target: 2,
    test: (e) => isWin(e) && isHigherRated(e),
    needs: { higherRated: true },
    link: '/lobby',
    icon: 'target',
  }),

  // --- puzzle races
  def({ id: 'join_race', title: 'Join a puzzle race', type: 'puzzle_race_joined', target: 1, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_3', title: 'Solve 3 puzzles in races', type: 'puzzle_solved', target: 3, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_5', title: 'Solve 5 puzzles in races', type: 'puzzle_solved', target: 5, link: '/puzzles', icon: 'puzzle' }),
  def({
    id: 'solve_hard_5',
    title: 'Solve 5 hard puzzles in races',
    type: 'puzzle_solved',
    target: 5,
    test: isHardPuzzle,
    link: '/puzzles',
    icon: 'puzzle',
  }),
  def({
    id: 'solve_hard_8',
    title: 'Solve 8 hard puzzles in races',
    type: 'puzzle_solved',
    target: 8,
    test: isHardPuzzle,
    link: '/puzzles',
    icon: 'puzzle',
  }),
  def({
    id: 'solve_hard_12',
    title: 'Solve 12 hard puzzles in races',
    type: 'puzzle_solved',
    target: 12,
    test: isHardPuzzle,
    link: '/puzzles',
    icon: 'puzzle',
  }),
  def({
    id: 'solve_hard_20',
    title: 'Solve 20 hard puzzles in races',
    type: 'puzzle_solved',
    target: 20,
    test: isHardPuzzle,
    link: '/puzzles',
    icon: 'puzzle',
  }),
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
    id: 'win_race',
    title: 'Win a puzzle race',
    type: 'puzzle_race_finished',
    target: 1,
    test: (e) => !!e.won,
    link: '/puzzles',
    icon: 'trophy',
  }),
  def({
    id: 'win_race_2',
    title: 'Win 2 puzzle races',
    type: 'puzzle_race_finished',
    target: 2,
    test: (e) => !!e.won,
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
 * Challenges that are no longer handed out (every one of them asked the player
 * to stake coins) but are still understood, so a record that was created
 * before they were removed can be finished and shown normally instead of
 * getting stuck on an id the catalog no longer knows. Never scheduled: see
 * assertCatalog(). Once the retire script has run and a week has passed this
 * whole block can be deleted.
 */
const wagered = (e: DailyEvent) => (e.wagerTokens ?? 0) > 0;
export const RETIRED: Record<string, ChallengeDef> = Object.fromEntries([
  def({ id: 'play_wagered_1', title: 'Play a wagered game', type: 'game_finished', target: 1, test: wagered, link: '/lobby', icon: 'swords' }),
  def({ id: 'play_wagered_2', title: 'Play 2 wagered games', type: 'game_finished', target: 2, test: wagered, link: '/lobby', icon: 'swords' }),
  def({ id: 'play_wagered_3', title: 'Play 3 wagered games', type: 'game_finished', target: 3, test: wagered, link: '/lobby', icon: 'swords' }),
  def({ id: 'win_wagered_1', title: 'Win a wagered game', type: 'game_finished', target: 1, test: (e) => isWin(e) && wagered(e), link: '/lobby', icon: 'crown' }),
  def({ id: 'win_wagered_2', title: 'Win 2 wagered games', type: 'game_finished', target: 2, test: (e) => isWin(e) && wagered(e), link: '/lobby', icon: 'crown' }),
  def({ id: 'high_stake_1', title: 'Play a game with a 100 R stake or more', type: 'game_finished', target: 1, test: (e) => (e.wagerTokens ?? 0) >= 100, link: '/lobby', icon: 'swords' }),
  def({ id: 'join_wagered_race', title: 'Join a wagered puzzle race', type: 'puzzle_race_joined', target: 1, test: wagered, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'complete_wagered_race', title: 'Solve every puzzle in a wagered race', type: 'puzzle_race_finished', target: 1, test: (e) => !!e.completed && wagered(e), link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'win_wagered_race', title: 'Win a wagered puzzle race', type: 'puzzle_race_finished', target: 1, test: (e) => !!e.won && wagered(e), link: '/puzzles', icon: 'trophy' }),
  // Also retired, but only because they were replaced by the Hard ladder below.
  def({ id: 'solve_8', title: 'Solve 8 puzzles in races', type: 'puzzle_solved', target: 8, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_10', title: 'Solve 10 puzzles in races', type: 'puzzle_solved', target: 10, link: '/puzzles', icon: 'puzzle' }),
  def({ id: 'solve_15', title: 'Solve 15 puzzles in races', type: 'puzzle_solved', target: 15, link: '/puzzles', icon: 'puzzle' }),
]);

/** Looks a challenge up by id, current or retired. */
export function challengeDef(id: string): ChallengeDef | undefined {
  return CATALOG[id] ?? RETIRED[id];
}

/**
 * The week. SCHEDULE[day - 1][slot] is the list of challenges that slot can
 * be on that day; one is picked per player (see pickChallenges). Offering a
 * choice lets a slot adapt: a player at the top of the ladder is never handed "beat a
 * higher-rated player", and nobody is handed "join a tournament" when none is open.
 * Every slot must contain at least one challenge with no `needs`, which
 * assertCatalog() below enforces.
 *
 * Difficulty climbs: Day 1 is a single game or a quick action; by Day 7 a
 * player needs several wins, a long win streak, two puzzle-race wins, twenty
 * hard puzzles or a win over a higher-rated player. Each slot's choices are
 * kept at about the same difficulty, so the luck of the draw doesn't make one
 * player's day twice as hard as another's.
 */
export const SCHEDULE: string[][][] = [
  // Day 1: one game, or a quick action
  [['play_1', 'play_blitz_1'], ['join_race', 'friend_request'], ['challenge_send', 'join_tournament']],
  // Day 2: first win, first puzzles
  [['win_1', 'play_960_1'], ['solve_3', 'join_tournament'], ['play_3', 'challenge_send', 'start_cage']],
  // Day 3: two wins, a clean race, a higher-rated opponent
  [['win_2', 'win_by_mate'], ['solve_5', 'complete_race'], ['play_3', 'win_blitz_1', 'play_higher_1']],
  // Day 4: harder wins, hard puzzles, first race win
  [['win_3', 'win_960_1'], ['solve_hard_5', 'win_race'], ['win_by_mate', 'beat_higher_1']],
  // Day 5
  [['win_3', 'win_streak_2'], ['solve_hard_8', 'win_race'], ['win_960_1', 'beat_higher_1']],
  // Day 6
  [['win_4', 'win_streak_3'], ['solve_hard_12', 'win_race_2'], ['win_960_2', 'beat_higher_1']],
  // Day 7: the hardest of the week
  [['win_5', 'win_streak_4'], ['solve_hard_20', 'win_race_2'], ['win_960_2', 'beat_higher_2']],
];

/** Fails loudly at startup if the schedule references a missing challenge or
 *  a slot could leave a player with nothing they can do. */
export function assertCatalog(): void {
  if (SCHEDULE.length !== 7 || DAY_REWARDS.length !== 7) throw new Error('daily challenges: need exactly 7 days');
  SCHEDULE.forEach((day, d) => {
    if (day.length !== 3) throw new Error(`daily challenges: day ${d + 1} needs exactly 3 slots`);
    day.forEach((pool, s) => {
      for (const id of pool) {
        if (!CATALOG[id]) throw new Error(`daily challenges: unknown challenge "${id}"`);
        if (RETIRED[id]) throw new Error(`daily challenges: "${id}" is retired and can't be scheduled`);
      }
      if (!pool.some((id) => !CATALOG[id].needs)) {
        throw new Error(`daily challenges: day ${d + 1} slot ${s + 1} has no challenge anyone can do`);
      }
    });
  });
}
assertCatalog();

// --- Picking a day's three -------------------------------------------------------
export interface PickContext {
  /** A tournament anyone can join for free is open right now. */
  openTournament: boolean;
  /** At least one player is rated above this one. */
  higherRatedExists: boolean;
}

function isAvailable(d: ChallengeDef, ctx: PickContext): boolean {
  if (d.needs?.openTournament && !ctx.openTournament) return false;
  if (d.needs?.higherRated && !ctx.higherRatedExists) return false;
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

/** Picks one slot of a day, never repeating something already `chosen` today. */
export function pickForSlot(
  userId: string,
  cycle: number,
  day: number,
  slot: number,
  ctx: PickContext,
  chosen: string[],
): string {
  const pool = SCHEDULE[day - 1][slot];
  let options = pool.filter((id) => isAvailable(CATALOG[id], ctx) && !chosen.includes(id));
  if (options.length === 0) {
    // Always exists thanks to assertCatalog (unless an earlier slot took it).
    options = pool.filter((id) => !CATALOG[id].needs && !chosen.includes(id));
  }
  if (options.length === 0) options = pool.filter((id) => !CATALOG[id].needs);
  return options[hash(`${userId}:${cycle}:${day}:${slot}`) % options.length];
}

export function pickChallenges(userId: string, cycle: number, day: number, ctx: PickContext): string[] {
  const chosen: string[] = [];
  SCHEDULE[day - 1].forEach((_pool, slot) => {
    chosen.push(pickForSlot(userId, cycle, day, slot, ctx, chosen));
  });
  return chosen;
}

/** Does this event count toward this challenge, and by how much (always 1)? */
export function eventCounts(d: ChallengeDef, e: DailyEvent): boolean {
  return d.type === e.type && (d.test ? d.test(e) : true);
}
