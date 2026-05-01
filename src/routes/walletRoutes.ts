import express from 'express';
import {
  getWalletSummary,
  getTransactionHistory,
  requestWithdrawal,
  requestTopUp,
} from '../controllers/walletController';
import { protect, isTraveler } from '../middlewares/authMiddleware';
import { upload } from '../utils/cloudinary';

const router = express.Router();

// All wallet routes require login + approved Traveler role
router.get('/summary', protect, isTraveler, getWalletSummary);
router.get('/transactions', protect, isTraveler, getTransactionHistory);
router.post('/withdraw', protect, isTraveler, requestWithdrawal);
router.post('/topup', protect, isTraveler, upload.single('slip'), requestTopUp);

export default router;
