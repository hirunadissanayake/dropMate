import express from 'express';
import { createParcel, getMyParcels, cancelParcel } from '../controllers/parcelController';
import { protect, isCustomer } from '../middlewares/authMiddleware';

const router = express.Router();

// Users must be logged in AND in approved Customer mode
router.use(protect);
router.use(isCustomer);

router.post('/create', createParcel);
router.get('/my', getMyParcels);
router.delete('/:id', cancelParcel);

export default router;
