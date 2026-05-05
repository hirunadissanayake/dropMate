import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { notifyAdmins } from '../utils/notificationHelpers';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallet/summary
// Returns the traveler's wallet balance + earnings summary with optional date filtering
// ─────────────────────────────────────────────────────────────────────────────
export const getWalletSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const { startDate, endDate } = req.query;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // 1. Today's stats
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todayOnline = await prisma.walletTransaction.aggregate({
      where: {
        userId,
        type: 'DELIVERY_EARNED',
        createdAt: { gte: startOfToday, lte: endOfToday }
      },
      _sum: { amount: true }
    });

    const todayCash = await prisma.parcel.aggregate({
      where: {
        status: 'DELIVERED',
        matchedTrip: { travelerId: userId },
        paymentMethod: { in: ['CASH_ON_PICKUP', 'CASH_ON_DELIVERY'] },
        updatedAt: { gte: startOfToday, lte: endOfToday }
      },
      _sum: { travelerPayout: true, price: true }
    });

    const tOnlineSum = todayOnline._sum?.amount || 0;
    const tCashPayoutSum = todayCash._sum?.travelerPayout || 0;
    const tCashTotalSum = todayCash._sum?.price || 0;

    const todayEarned = tOnlineSum + tCashPayoutSum;

    // 2. All-time stats
    const totalEarnedAllTime = await prisma.walletTransaction.aggregate({
      where: { userId, type: 'DELIVERY_EARNED' },
      _sum: { amount: true }
    });

    const cashEarnedAllTime = await prisma.parcel.aggregate({
      where: {
        status: 'DELIVERED',
        matchedTrip: { travelerId: userId },
        paymentMethod: { in: ['CASH_ON_PICKUP', 'CASH_ON_DELIVERY'] }
      },
      _sum: { travelerPayout: true, price: true }
    });

    const allOnlineSum = totalEarnedAllTime._sum?.amount || 0;
    const allCashPayoutSum = cashEarnedAllTime._sum?.travelerPayout || 0;

    const finalTotalEarnedAllTime = allOnlineSum + allCashPayoutSum;

    // 3. Period stats (defaulting to all-time if no dates provided)
    let periodEarned = finalTotalEarnedAllTime;
    let periodCashEarnings = cashEarnedAllTime._sum.travelerPayout || 0;
    let periodOnlineEarnings = totalEarnedAllTime._sum.amount || 0;

    if (startDate && endDate) {
      const s = new Date(startDate as string);
      const e = new Date(endDate as string);
      e.setHours(23, 59, 59, 999);

      const rangeOnline = await prisma.walletTransaction.aggregate({
        where: {
          userId,
          type: 'DELIVERY_EARNED',
          createdAt: { gte: s, lte: e }
        },
        _sum: { amount: true }
      });

      const rangeCash = await prisma.parcel.aggregate({
        where: {
          status: 'DELIVERED',
          matchedTrip: { travelerId: userId },
          paymentMethod: { in: ['CASH_ON_PICKUP', 'CASH_ON_DELIVERY'] },
          updatedAt: { gte: s, lte: e }
        },
        _sum: { travelerPayout: true, price: true }
      });

      periodOnlineEarnings = rangeOnline._sum?.amount || 0;
      periodCashEarnings = rangeCash._sum?.travelerPayout || 0;
      periodEarned = periodOnlineEarnings + periodCashEarnings;
    }

    // 4. Withdrawals
    const pendingWithdrawals = await prisma.walletTransaction.aggregate({
      where: { userId, type: 'WITHDRAWAL', status: 'PENDING' },
      _sum: { amount: true }
    });

    const completedWithdrawals = await prisma.walletTransaction.aggregate({
      where: { userId, type: 'WITHDRAWAL', status: 'COMPLETED' },
      _sum: { amount: true }
    });

    return res.status(200).json({
      walletBalance: user.walletBalance,
      todayEarned,
      todayCashCollection: tCashTotalSum,
      totalEarned: finalTotalEarnedAllTime,
      cashEarned: allCashPayoutSum,
      periodEarned,
      periodCashEarnings,
      periodOnlineEarnings,
      pendingWithdrawals: pendingWithdrawals._sum?.amount || 0,
      totalWithdrawn: completedWithdrawals._sum?.amount || 0
    });
  } catch (error) {
    console.error('getWalletSummary error:', error);
    return res.status(500).json({ message: 'Error fetching wallet summary' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallet/transactions
// Returns the traveler's transaction history with optional date filtering
// ─────────────────────────────────────────────────────────────────────────────
export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const { startDate, endDate, limit } = req.query;

    let where: any = { userId };

    if (startDate && endDate) {
      const s = new Date(startDate as string);
      const e = new Date(endDate as string);
      e.setHours(23, 59, 59, 999);

      where.createdAt = {
        gte: s,
        lte: e
      };
    }

    const transactions = await prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit as string) : 100
    });

    return res.status(200).json(transactions);
  } catch (error) {
    console.error('getTransactionHistory error:', error);
    return res.status(500).json({ message: 'Error fetching transactions' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallet/withdraw
// Traveler requests a withdrawal. This queues it for admin to process manually.
// Body: { amount, bankName, accountNumber, accountHolderName }
// ─────────────────────────────────────────────────────────────────────────────
export const requestWithdrawal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const { amount, bankDetailId, bankName, accountNumber, accountHolderName, branchName } = req.body;

    let targetBankName = bankName;
    let targetAccountNumber = accountNumber;
    let targetAccountHolderName = accountHolderName;

    let targetBranchName = branchName;

    if (bankDetailId) {
      const savedBank = await prisma.bankDetail.findFirst({
        where: { id: bankDetailId, userId }
      });
      if (!savedBank) {
        return res.status(404).json({ message: 'Saved bank detail not found' });
      }
      targetBankName = savedBank.bankName;
      targetAccountNumber = savedBank.accountNumber;
      targetAccountHolderName = savedBank.accountHolderName;
      targetBranchName = savedBank.branchName;
    } else {
      if (!amount || !bankName || !accountNumber || !accountHolderName) {
        return res.status(400).json({ message: 'Amount and all bank details (or a bankDetailId) are required' });
      }
    }

    if (!amount) {
      return res.status(400).json({ message: 'Withdrawal amount is required' });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return res.status(400).json({ message: 'Invalid withdrawal amount' });
    }

    // Check if traveler has enough balance
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.walletBalance < withdrawAmount) {
      return res.status(400).json({
        message: `Insufficient balance. Available: LKR ${user.walletBalance.toFixed(2)}`
      });
    }

    // Minimum withdrawal of LKR 500
    if (withdrawAmount < 500) {
      return res.status(400).json({ message: 'Minimum withdrawal amount is LKR 500' });
    }

    const description = `Withdrawal to ${targetBankName}${targetBranchName ? ' (' + targetBranchName + ')' : ''} | Acc: ${targetAccountNumber} | Name: ${targetAccountHolderName}`;

    // Atomic: Deduct balance + create pending withdrawal record
    await prisma.$transaction([
      // 1. Deduct from wallet immediately (funds are "locked")
      prisma.user.update({
        where: { id: userId },
        data: { walletBalance: { decrement: withdrawAmount } }
      }),
      // 2. Create a PENDING withdrawal record for admin to process
      prisma.walletTransaction.create({
        data: {
          userId,
          type: 'WITHDRAWAL',
          amount: withdrawAmount,
          status: 'PENDING',
          description
        }
      })
    ]);

    // ✅ Notify Admin about new withdrawal request
    await notifyAdmins({
      type: 'GENERAL',
      title: 'Withdrawal Request 💸',
      body: `A traveler has requested a withdrawal of LKR ${withdrawAmount.toFixed(2)}.`,
      metadata: { userId, amount: withdrawAmount, description }
    });

    return res.status(200).json({
      message: `Withdrawal of LKR ${withdrawAmount.toFixed(2)} requested. It will be processed within 1-2 business days.`
    });
  } catch (error) {
    console.error('requestWithdrawal error:', error);
    return res.status(500).json({ message: 'Error processing withdrawal request' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallet/topup
// Traveler requests a wallet topup by providing an amount and a slip URL.
// Body: { amount, slipUrl }
// ─────────────────────────────────────────────────────────────────────────────
export const requestTopUp = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const { amount } = req.body;
    const slipUrl = req.file?.path;

    if (!amount || !slipUrl) {
      return res.status(400).json({ message: 'Amount and deposit slip image are required' });
    }

    const topUpAmount = parseFloat(amount);
    if (isNaN(topUpAmount) || topUpAmount <= 0) {
      return res.status(400).json({ message: 'Invalid top-up amount' });
    }

    // Create a PENDING top-up request
    const topUpRequest = await prisma.topUpRequest.create({
      data: {
        userId,
        amount: topUpAmount,
        slipUrl,
        status: 'PENDING'
      }
    });

    // ✅ Notify Admin about new top-up request
    await notifyAdmins({
      type: 'GENERAL',
      title: 'Top-Up Request 💳',
      body: `A traveler has submitted a deposit slip for LKR ${topUpAmount.toFixed(2)}.`,
      metadata: { userId, amount: topUpAmount, topUpRequestId: topUpRequest.id }
    });

    return res.status(201).json({
      message: 'Top-up request submitted successfully. Our team will verify your slip and credit your wallet shortly.',
      topUpRequest
    });
  } catch (error) {
    console.error('requestTopUp error:', error);
    return res.status(500).json({ message: 'Error processing top-up request' });
  }
};
