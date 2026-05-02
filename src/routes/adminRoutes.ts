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
  updateAdminProfile,
  getAllParcelsAdmin,
  getAllTripsAdmin,
  getAllTransactionsAdmin,
  updateTransactionStatus,
  getWalletStatsAdmin,
  globalSearch,
  getSupportChatUsers,
  blockUser,
  getTopUpsAdmin,
  updateTopUpStatus
} from '../controllers/adminController';
import { 
  createRoute, 
  getRoutes, 
  updateRoute, 
  deleteRoute,
  createWeightSlab, 
  getWeightSlabs, 
  updateWeightSlab,
  deleteWeightSlab,
  updateConfig, 
  getConfig,
  deleteConfig
} from '../controllers/pricingController';
import { 
  getDropMateBankDetailsAdmin, 
  createDropMateBankDetail, 
  updateDropMateBankDetail, 
  deleteDropMateBankDetail 
} from '../controllers/dropmateBankController';
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
router.get('/parcels', getAllParcelsAdmin);
router.get('/trips', getAllTripsAdmin);
router.get('/transactions', getAllTransactionsAdmin);
router.get('/wallet-stats', getWalletStatsAdmin);
router.post('/transactions/status', updateTransactionStatus);
router.get('/customers', getApprovedCustomers);
router.get('/travelers', getApprovedTravelers);
router.post('/approve', approveUser);
router.post('/block', blockUser);
router.get('/search', globalSearch);
router.get('/support/chats', getSupportChatUsers);

// Top-ups
router.get('/top-ups', getTopUpsAdmin);
router.post('/top-ups/status', updateTopUpStatus);

// Admin Profile
router.get('/me', getAdminMe);
router.put('/update-profile', updateAdminProfile);

// --- PRICING MANAGEMENT ---

// Routes
router.post('/routes', createRoute);
router.get('/routes', getRoutes);
router.put('/routes/:id', updateRoute);
router.delete('/routes/:id', deleteRoute);

// Weight Slabs
router.post('/weight-slabs', createWeightSlab);
router.get('/weight-slabs', getWeightSlabs);
router.put('/weight-slabs/:id', updateWeightSlab);
router.delete('/weight-slabs/:id', deleteWeightSlab);

// Platform Config
router.post('/config', updateConfig);
router.get('/config', getConfig);
router.delete('/config/:key', deleteConfig);

// DropMate Bank Details
router.get('/dropmate-bank-details', getDropMateBankDetailsAdmin);
router.post('/dropmate-bank-details', createDropMateBankDetail);
router.put('/dropmate-bank-details/:id', updateDropMateBankDetail);
router.delete('/dropmate-bank-details/:id', deleteDropMateBankDetail);

export default router;
