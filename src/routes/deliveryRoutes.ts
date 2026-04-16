import express from 'express';
import { 
  requestMatch, initiatePickup, verifyPickup, initiateDelivery, verifyDelivery 
} from '../controllers/deliveryController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

router.use(protect);
router.use(isTraveler);

router.post('/match-request', requestMatch);
router.post('/pickup/initiate', initiatePickup);
router.post('/pickup/verify', verifyPickup);
router.post('/delivery/initiate', initiateDelivery);
router.post('/delivery/verify', verifyDelivery);

export default router;
