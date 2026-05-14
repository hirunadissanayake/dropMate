import express from 'express';
import { createReview, getUserReviews } from '../controllers/reviewController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Public routes (or specifically allowed)
router.get('/user/:userId', getUserReviews);

// Protected routes
router.use(protect);
router.post('/', createReview);

export default router;
