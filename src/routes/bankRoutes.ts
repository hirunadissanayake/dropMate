import express from 'express';
import {
  getBankDetails,
  addBankDetail,
  updateBankDetail,
  deleteBankDetail
} from '../controllers/bankController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

// All bank routes require login + Traveler role
router.get('/', protect, isTraveler, getBankDetails);
router.post('/', protect, isTraveler, addBankDetail);
router.put('/:id', protect, isTraveler, updateBankDetail);
router.delete('/:id', protect, isTraveler, deleteBankDetail);

export default router;
