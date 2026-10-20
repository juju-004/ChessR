import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { getCurrent, getSeason, getPast } from '../controllers/seasonLeaderboard.controller.js';

const router = Router();

// Public; auth is optional and only adds the caller's own row ("me").
router.get('/seasons/current', optionalAuth, getCurrent);
router.get('/seasons/past', getPast); // before :season so "past" isn't parsed as a number
router.get('/seasons/:season', optionalAuth, getSeason);

export default router;
