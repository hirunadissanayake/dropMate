import express from 'express';
import { requestOtp, verifyOtp, login, forgotPassword, verifyResetOtp, resetPassword } from '../controllers/authController';
import { upload } from '../utils/cloudinary';

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

export default router;
