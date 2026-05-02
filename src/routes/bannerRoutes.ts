import express from 'express';
import * as bannerController from '../controllers/bannerController';
import { upload } from '../utils/cloudinary';
import { protect, isAdmin } from '../middlewares/authMiddleware';

const router = express.Router();

// Public route to get active banners for the app
router.get('/', bannerController.getBanners);

// Admin routes
router.get('/admin/all', protect, isAdmin, bannerController.getAllBannersAdmin);
router.post('/', protect, isAdmin, upload.single('image'), bannerController.createBanner);
router.patch('/:id', protect, isAdmin, upload.single('image'), bannerController.updateBanner);
router.delete('/:id', protect, isAdmin, bannerController.deleteBanner);

export default router;
