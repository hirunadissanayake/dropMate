import express from 'express';
import {
  getWalletSummary,
  getTransactionHistory,
  requestWithdrawal,
} from '../controllers/walletController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

// All wallet routes require login + approved Traveler role
router.get('/summary', protect, isTraveler, getWalletSummary);
router.get('/transactions', protect, isTraveler, getTransactionHistory);
router.post('/withdraw', protect, isTraveler, requestWithdrawal);

export default router;
