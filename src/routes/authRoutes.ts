import express from 'express';
import { 
  requestOtp, 
  verifyOtp, 
  login, 
  forgotPassword, 
  verifyResetOtp, 
  resetPassword,
  getMe,
  switchRole,
  requestNewRole,
  updateUserProfile,
  changePassword
} from '../controllers/authController';
import { upload } from '../utils/cloudinary';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

router.post('/login', upload.none(), login);
router.post('/forgot-password', upload.none(), forgotPassword);
router.post('/verify-reset-otp', upload.none(), verifyResetOtp);
router.post('/reset-password', upload.none(), resetPassword);

router.post('/request-otp', upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'nicFront', maxCount: 1 },
  { name: 'nicBack', maxCount: 1 }
]), requestOtp);

router.post('/verify-otp', upload.none(), verifyOtp);

// Protected routes
router.get('/me', protect, getMe);
router.post('/switch-role', protect, upload.none(), switchRole);
router.post('/request-new-role', protect, upload.fields([
  { name: 'selfie', maxCount: 1 },
  { name: 'nicFront', maxCount: 1 },
  { name: 'nicBack', maxCount: 1 }
]), requestNewRole);

router.put('/update-profile', protect, upload.none(), updateUserProfile);
router.post('/change-password', protect, upload.none(), changePassword);

export default router;
