import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import {
  listMyTeams,
  searchTeams,
  getTeam,
  listMembers,
  createTeam,
  updateTeam,
  joinTeam,
  cancelJoinRequest,
  listJoinRequests,
  respondToJoinRequest,
  leaveTeam,
  transferOwnership,
  kickMember,
  deleteTeam,
  getTeamTournaments,
  addLeader,
  removeLeader,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/team.controller.js';

const router = Router();
router.use(requireAuth);

// Entry codes are short, so guess attempts are throttled per client.
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many join attempts, slow down a little' },
});

router.get('/mine', listMyTeams);
router.get('/search', searchTeams);
router.post('/', createTeam);
router.get('/:id', getTeam);
router.patch('/:id', updateTeam);
router.delete('/:id', deleteTeam);
router.get('/:id/members', listMembers);
router.get('/:id/tournaments', getTeamTournaments);
router.post('/:id/join', joinLimiter, joinTeam);
router.delete('/:id/join', cancelJoinRequest);
router.get('/:id/requests', listJoinRequests);
router.post('/:id/requests/:requestId/respond', respondToJoinRequest);
router.post('/:id/leave', leaveTeam);
router.post('/:id/transfer', transferOwnership);
router.delete('/:id/members/:userId', kickMember);
router.post('/:id/leaders', addLeader);
router.delete('/:id/leaders/:userId', removeLeader);
router.get('/:id/announcements', listAnnouncements);
router.post('/:id/announcements', createAnnouncement);
router.patch('/:id/announcements/:announcementId', updateAnnouncement);
router.delete('/:id/announcements/:announcementId', deleteAnnouncement);

export default router;
