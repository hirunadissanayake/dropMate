import express from 'express';
import {
  generatePaymentHash,
  payhereWebhook,
  getPaymentStatus,
} from '../controllers/paymentController';
import { protect, isCustomer } from '../middlewares/authMiddleware';

const router = express.Router();

// ── Protected routes (require login + customer role) ──────────────────────────

// Called by the mobile app BEFORE opening the PayHere SDK.
// Returns: { hash, merchant_id, order_id, amount, currency, sandbox }
router.post('/generate-hash', protect, isCustomer, generatePaymentHash);

// Called by the mobile app to poll whether the payment went through.
router.get('/status/:parcelId', protect, isCustomer, getPaymentStatus);

// ── Public route (no auth — PayHere calls this directly) ──────────────────────

// PayHere's server sends payment notifications here.
// NOTE: This MUST be a publicly accessible HTTPS URL.
// Use Ngrok for local testing: ngrok http 5000
router.post('/webhook', payhereWebhook);

export default router;
