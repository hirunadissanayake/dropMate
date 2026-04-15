import express from 'express';
import { createTrip, getMyTrips, getAllActiveTrips } from '../controllers/tripController';
import { protect, isApproved } from '../middlewares/authMiddleware';

const router = express.Router();

// Publicly visible to matched customers, but creation is protected
router.get('/active', getAllActiveTrips);

router.use(protect);
router.use(isApproved);

router.post('/create', createTrip);
router.get('/my', getMyTrips);

export default router;
