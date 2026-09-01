import { Router } from 'express';
import { env } from '../config/env.js';
import { RATING_TIERS } from '../services/rating.service.js';

const router = Router();

// Public, no auth, just the handful of operator-tunable settings the
// client needs to render accurately (e.g. "winner takes the pot minus a
// 10% fee" on the create-game/cage-match/tournament forms). Nothing here
// should ever be sensitive; if a setting needs to stay server-only, it
// doesn't belong in this response.
//
// ratingTiers: the tier ladder's name+min thresholds, so the "what do the
// rank badges mean" help tip (RatingBadge/HelpTip) can show real numbers
// instead of a copy hardcoded client-side that would silently drift the
// moment RATING_TIERS changes here. The hidden rating itself is never
// exposed, only where the public tier boundaries sit.
router.get('/', (_req, res) => {
  res.json({ rakePercent: env.RAKE_PERCENT, ratingTiers: RATING_TIERS });
});

export default router;
