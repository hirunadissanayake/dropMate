import express from 'express';
import { createTrip, getMyTrips, getAllActiveTrips, cancelTrip, deleteTrip, getTripById, updateTripCapacity, toggleTripStatus } from '../controllers/tripController';
import { getFromLocations, getToLocations } from '../controllers/pricingController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

// Publicly visible to matched customers, but creation is protected
router.use(protect);

// Now protected routes
router.get('/active', getAllActiveTrips);
router.get('/my', isTraveler, getMyTrips);
router.get('/from-locations', getFromLocations);
router.get('/to-locations', getToLocations);

// Wildcard Route (Must be after specific static routes like /my and /active)
router.get('/:id', getTripById);

// Traveler Specific Actions (Non-wildcard or specific prefixes)
router.use(isTraveler);
router.post('/create', createTrip);
router.put('/cancel/:id', cancelTrip);
router.put('/update-capacity/:id', updateTripCapacity);
router.patch('/:id/toggle-status', toggleTripStatus);
router.delete('/delete/:id', deleteTrip);

export default router;
