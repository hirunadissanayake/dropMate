import express from 'express';
import { createParcel, getMyParcels, cancelParcel } from '../controllers/parcelController';
import { protect, isApproved } from '../middlewares/authMiddleware';

const router = express.Router();

// Users must be logged in AND approved by Admin to use these
router.use(protect);
router.use(isApproved);

router.post('/create', createParcel);
router.get('/my', getMyParcels);
router.delete('/:id', cancelParcel);

export default router;
