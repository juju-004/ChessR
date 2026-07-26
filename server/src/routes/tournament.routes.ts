import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import {
  getOpenTournaments,
  getMyTournaments,
  getTournamentByCodeHandler,
} from "../controllers/tournament.controller.js";

const router = Router();

router.get("/", optionalAuth, getOpenTournaments);
router.get("/mine", requireAuth, getMyTournaments);
router.get("/code/:code", optionalAuth, getTournamentByCodeHandler);

export default router;
