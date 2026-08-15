import { Router } from 'express';
import { env } from '../config/env.js';

const router = Router();

// Public, no auth — just the handful of operator-tunable settings the
// client needs to render accurately (e.g. "winner takes the pot minus a
// 10% fee" on the create-game/cage-match/tournament forms). Nothing here
// should ever be sensitive; if a setting needs to stay server-only, it
// doesn't belong in this response.
router.get('/', (_req, res) => {
  res.json({ rakePercent: env.RAKE_PERCENT });
});

export default router;
