import express from 'express';
import { 
  requestMatch, 
  getPendingMatches,
  acceptMatch,
  rejectMatch,
  expireMatch,
  cancelMatch,
  initiatePickup, 
  verifyPickup, 
  initiateDelivery, 
  verifyDelivery 
} from '../controllers/deliveryController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

router.use(protect);

// 1. MATCHING (Accessible to both Customers and Travelers)
router.post('/match-request', requestMatch);
router.get('/pending-matches', getPendingMatches);
router.patch('/match/:id/accept', acceptMatch);
router.patch('/match/:id/reject', rejectMatch);
router.patch('/match/:id/expire', expireMatch);
router.patch('/match/:id/cancel', cancelMatch);

// 2. LOGISTICS (Restricted to Travelers only)
router.use(isTraveler);
router.post('/pickup/initiate', initiatePickup);
router.post('/pickup/verify', verifyPickup);
router.post('/delivery/initiate', initiateDelivery);
router.post('/delivery/verify', verifyDelivery);

export default router;
