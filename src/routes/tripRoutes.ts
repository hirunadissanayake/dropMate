import express from 'express';
import { createTrip, getMyTrips, getAllActiveTrips } from '../controllers/tripController';
import { getFromLocations, getToLocations } from '../controllers/pricingController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

// Publicly visible to matched customers, but creation is protected
router.get('/active', getAllActiveTrips);

router.use(protect);
router.use(isTraveler);

router.post('/create', createTrip);
router.get('/my', getMyTrips);
router.get('/from-locations', getFromLocations);
router.get('/to-locations', getToLocations);

export default router;
