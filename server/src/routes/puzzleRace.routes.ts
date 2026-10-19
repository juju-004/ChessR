import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createPuzzleRace,
  joinPuzzleRace,
  leavePuzzleRace,
  cancelPuzzleRace,
  startPuzzleRace,
  listOpenPuzzleRaces,
  getMyPuzzleRace,
  getPuzzleRaceByCode,
} from '../controllers/puzzleRace.controller.js';

const router = Router();

router.get('/open', requireAuth, listOpenPuzzleRaces);
router.get('/mine', requireAuth, getMyPuzzleRace);
router.get('/code/:code', requireAuth, getPuzzleRaceByCode);
router.post('/', requireAuth, createPuzzleRace);
router.post('/:id/join', requireAuth, joinPuzzleRace);
router.post('/:id/leave', requireAuth, leavePuzzleRace);
router.post('/:id/cancel', requireAuth, cancelPuzzleRace);
router.post('/:id/start', requireAuth, startPuzzleRace);

export default router;
