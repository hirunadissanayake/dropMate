import express from 'express';
import { createTrip, getMyTrips, getAllActiveTrips, cancelTrip, deleteTrip, getTripById } from '../controllers/tripController';
import { getFromLocations, getToLocations } from '../controllers/pricingController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

// Publicly visible to matched customers, but creation is protected
router.get('/active', getAllActiveTrips);

router.use(protect);

// Static Routes (Specific names)
router.get('/my', isTraveler, getMyTrips);
router.get('/from-locations', isTraveler, getFromLocations);
router.get('/to-locations', isTraveler, getToLocations);

// Wildcard Route (Must be after specific static routes like /my and /active)
router.get('/:id', getTripById);

// Traveler Specific Actions (Non-wildcard or specific prefixes)
router.use(isTraveler);
router.post('/create', createTrip);
router.put('/cancel/:id', cancelTrip);
router.delete('/delete/:id', deleteTrip);

export default router;
