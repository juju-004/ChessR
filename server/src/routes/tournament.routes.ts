import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import {
  getOpenTournaments,
  getMyTournaments,
  getTournamentByCodeHandler,
} from "../controllers/tournament.controller.js";
import { getTournamentOgCard } from "../controllers/og.controller.js";

const router = Router();

router.get("/", optionalAuth, getOpenTournaments);
router.get("/mine", requireAuth, getMyTournaments);
// No auth, this is fetched by link-preview crawlers (WhatsApp, Facebook,
// etc.), which never carry a session. See og.controller.ts for the caveat
// about needing frontend-side routing for this to actually get hit by them.
router.get("/code/:code/card", getTournamentOgCard);
router.get("/code/:code", optionalAuth, getTournamentByCodeHandler);

export default router;
