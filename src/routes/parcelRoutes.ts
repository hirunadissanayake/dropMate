import express from 'express';
import { createParcel, getMyParcels, cancelParcel, deleteParcel } from '../controllers/parcelController';
import { getPricePreview, getRoutes } from '../controllers/pricingController';
import { protect, isCustomer } from '../middlewares/authMiddleware';
import { upload } from '../utils/cloudinary';

const router = express.Router();

// Public routes for logged-in users to check rates before creating a parcel
router.get('/routes', protect, getRoutes);
router.get('/preview-price', protect, getPricePreview);

// Users must be logged in AND in approved Customer mode
router.post('/create', protect, isCustomer, upload.array('images', 4), createParcel);
router.get('/my', protect, isCustomer, getMyParcels);
router.put('/:id/cancel', protect, isCustomer, cancelParcel);
router.delete('/:id', protect, isCustomer, deleteParcel);

export default router;
