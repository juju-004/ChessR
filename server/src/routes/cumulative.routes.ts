import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { getAll, getMine, create, getOne, getStandings } from "../controllers/cumulative.controller.js";

const router = Router();

// Creating a league is rare and organisation-only; this just caps spam.
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/", optionalAuth, getAll);
// Before "/:id" so "mine" isn't read as an id.
router.get("/mine", requireAuth, getMine);
router.post("/", requireAuth, createLimiter, create);
router.get("/:id", optionalAuth, getOne);
router.get("/:id/standings", optionalAuth, getStandings);

export default router;
