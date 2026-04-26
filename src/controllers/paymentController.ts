import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { createNotification } from './notificationController';
import { notifyAdmins } from '../utils/notificationHelpers';


const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Generate MD5 hash (PayHere requires uppercase MD5)
// ─────────────────────────────────────────────────────────────────────────────
const md5 = (value: string): string =>
  crypto.createHash('md5').update(value).digest('hex').toUpperCase();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/generate-hash
// Called by the React Native app BEFORE launching the PayHere SDK.
// The app sends: { parcel_id }
// This returns: { hash, merchant_id, order_id, amount, currency, ... }
// ─────────────────────────────────────────────────────────────────────────────
export const generatePaymentHash = async (req: AuthRequest, res: Response) => {
  try {
    const { parcel_id } = req.body;

    if (!parcel_id) {
      return res.status(400).json({ message: 'parcel_id is required' });
    }

    const pId = parcel_id as string;
    // 1. Fetch parcel from DB to get the real price
    const parcel = await prisma.parcel.findUnique({ where: { id: pId } });

    if (!parcel) {
      return res.status(404).json({ message: 'Parcel not found' });
    }

    // 2. Only the owner can pay for their parcel
    if (parcel.senderId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // 3. Don't allow double payment
    if (parcel.paymentStatus === 'PAID') {
      return res.status(400).json({ message: 'This parcel is already paid' });
    }

    if (!parcel.price) {
      return res.status(400).json({ message: 'Parcel price is not set' });
    }

    const merchant_id = process.env.PAYHERE_MERCHANT_ID!;
    const merchant_secret = process.env.PAYHERE_MERCHANT_SECRET!;
    const currency = 'LKR';
    const order_id = parcel.id; // Use parcel ID as the unique order ID
    const amount = parcel.price.toFixed(2); // PayHere requires 2 decimal places

    // 4. Build the PayHere hash:
    //    MD5( merchant_id + order_id + amount + currency + MD5(merchant_secret) )
    const hashedSecret = md5(merchant_secret);
    const rawHash = `${merchant_id}${order_id}${amount}${currency}${hashedSecret}`;
    const hash = md5(rawHash);

    // 5. Return everything the mobile app needs to start the payment
    return res.status(200).json({
      hash,
      merchant_id,
      order_id,
      amount,
      currency,
      sandbox: process.env.PAYHERE_IS_SANDBOX === 'true',
    });
  } catch (error) {
    console.error('generatePaymentHash error:', error);
    return res.status(500).json({ message: 'Error generating payment hash' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payment/webhook
// PayHere calls this URL silently after a payment succeeds or fails.
// This endpoint MUST be publicly accessible (HTTPS) — use Ngrok for local testing.
// This is the ONLY place we mark a parcel as PAID in the database.
// ─────────────────────────────────────────────────────────────────────────────
export const payhereWebhook = async (req: Request, res: Response) => {
  try {
    const {
      merchant_id,
      order_id,       // This is our parcel ID
      payhere_amount,
      payhere_currency,
      status_code,    // 2=Success, 0=Pending, -1=Canceled, -2=Failed, -3=Chargebacked
      md5sig,
    } = req.body;

    const merchant_secret = process.env.PAYHERE_MERCHANT_SECRET!;

    // ── SECURITY: Verify the signature to prove this came from PayHere ──
    const hashedSecret = md5(merchant_secret);
    const localSig = md5(
      `${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${hashedSecret}`
    );

    if (localSig !== md5sig) {
      console.warn(`PayHere webhook signature mismatch for order: ${order_id}`);
      // Still return 200 so PayHere doesn't keep retrying; we just ignore it.
      return res.status(200).send('SIGNATURE_MISMATCH');
    }

    const oId = order_id as string;
    // ── Handle status codes ──
    if (status_code == 2) {
      // ✅ Payment SUCCESS — mark parcel as PAID and calculate payout
      const parcel = await prisma.parcel.findUnique({ where: { id: oId } });

      if (!parcel) {
        console.error(`Webhook: Parcel not found for order_id: ${order_id}`);
        return res.status(200).send('PARCEL_NOT_FOUND');
      }

      if (parcel.paymentStatus === 'PAID') {
        // Already processed (PayHere can send duplicate webhooks)
        return res.status(200).send('ALREADY_PAID');
      }

      // Calculate DropMate commission and traveler payout from the parcel's stored pricing
      // (These were already calculated when the parcel was created)
      await prisma.parcel.update({
        where: { id: oId },
        data: { paymentStatus: 'PAID' },
      });

      // Notify the customer
      await createNotification({
        userId: parcel.senderId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment Successful! ✅',
        body: `Your payment of LKR ${payhere_amount} for parcel #${parcel.id.slice(-6).toUpperCase()} has been confirmed.`,
        metadata: { parcelId: parcel.id }
      });

      // ✅ Notify Admins
      await notifyAdmins({
        type: 'PAYMENT_RECEIVED',
        title: 'New Payment Confirmed! 💰',
        body: `Payment of LKR ${payhere_amount} received for parcel #${parcel.id.slice(-6).toUpperCase()}.`,
        metadata: { parcelId: parcel.id, amount: payhere_amount }
      });



      console.log(
        `✅ Payment confirmed for Parcel: ${order_id} | Amount: ${payhere_amount} LKR | Traveler Payout: ${parcel.travelerPayout} LKR`
      );

    } else if (status_code == 0) {
      console.log(`⏳ Payment PENDING for order: ${order_id}`);
      await prisma.parcel.update({
        where: { id: oId },
        data: { paymentStatus: 'PENDING' },
      });

    } else if (status_code == -1) {
      console.log(`❌ Payment CANCELLED for order: ${order_id}`);
      await prisma.parcel.update({
        where: { id: oId },
        data: { paymentStatus: 'FAILED' },
      });

    } else if (status_code == -2 || status_code == -3) {
      console.log(`❌ Payment FAILED/CHARGEBACKED for order: ${order_id}`);
      await prisma.parcel.update({
        where: { id: oId },
        data: { paymentStatus: 'FAILED' },
      });
    }

    // Always return 200 so PayHere stops retrying
    return res.status(200).send('OK');
  } catch (error) {
    console.error('payhereWebhook error:', error);
    // Still return 200 to prevent PayHere retry storm
    return res.status(200).send('INTERNAL_ERROR');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payment/status/:parcelId
// The app polls this after returning from the PayHere SDK to check if the
// webhook was received and the parcel is now PAID.
// ─────────────────────────────────────────────────────────────────────────────
export const getPaymentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.params;
    const idStr = parcelId as string;

    const parcel = await prisma.parcel.findUnique({
      where: { id: idStr },
      select: { id: true, senderId: true, paymentStatus: true, price: true },
    });

    if (!parcel) {
      return res.status(404).json({ message: 'Parcel not found' });
    }

    if (parcel.senderId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    return res.status(200).json({
      parcelId: parcel.id,
      paymentStatus: parcel.paymentStatus,
      amount: parcel.price,
    });
  } catch (error) {
    console.error('getPaymentStatus error:', error);
    return res.status(500).json({ message: 'Error fetching payment status' });
  }
};
