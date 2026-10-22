import { Router } from 'express';
import {
  getScorecard,
  confirmScorecardOccurrence,
  submitScorecard,
} from '../controllers/scorecard.controller.js';

const router = Router();

// PUBLIC routes — intentionally NO authenticate middleware: the interviewer
// scorecard link is opened by interviewers/HR/CEO who have no ATS session
// (mirrors the open-tracking pixel in tracking.routes.js). The uuid token is
// the only credential, validated in the controller; it opens the form once,
// records the "did it happen?" answer, and expires after a single submit.
router.get('/:token', getScorecard);
router.post('/:token/occurrence', confirmScorecardOccurrence);
router.post('/:token/submit', submitScorecard);

export default router;
