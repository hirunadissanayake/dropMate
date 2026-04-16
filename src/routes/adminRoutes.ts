import express from 'express';
import { 
  getPendingUsers, 
  approveUser, 
  getAllUsers, 
  adminRegister, 
  adminLogin, 
  forgotPassword, 
  verifyResetOtp, 
  resetPassword,
  getApprovedCustomers,
  getApprovedTravelers,
  getAdminMe,
  updateAdminProfile
} from '../controllers/adminController';
import { protect, isAdmin } from '../middlewares/authMiddleware';
import { upload } from '../utils/cloudinary';

const router = express.Router();

// Public Admin routes (No token required)
router.post('/register', upload.none(), adminRegister);
router.post('/login', upload.none(), adminLogin);
router.post('/forgot-password', upload.none(), forgotPassword);
router.post('/verify-reset-otp', upload.none(), verifyResetOtp);
router.post('/reset-password', upload.none(), resetPassword);

// Protected Admin routes (Require ADMIN role)
router.use(protect);
router.use(isAdmin);

router.get('/pending', getPendingUsers);
router.get('/all', getAllUsers);
router.get('/customers', getApprovedCustomers);
router.get('/travelers', getApprovedTravelers);
router.post('/approve', approveUser);

// Admin Profile
router.get('/me', getAdminMe);
router.put('/update-profile', updateAdminProfile);

export default router;
