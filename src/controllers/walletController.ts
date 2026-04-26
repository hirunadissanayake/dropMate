import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { notifyAdmins } from '../utils/notificationHelpers';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallet/summary
// Returns the traveler's wallet balance + earnings summary
// ─────────────────────────────────────────────────────────────────────────────
export const getWalletSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalance: true }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Total earned all time
    const totalEarned = await prisma.walletTransaction.aggregate({
      where: { userId, type: 'DELIVERY_EARNED' },
      _sum: { amount: true }
    });

    // Pending withdrawals (requested but not yet processed)
    const pendingWithdrawals = await prisma.walletTransaction.aggregate({
      where: { userId, type: 'WITHDRAWAL', status: 'PENDING' },
      _sum: { amount: true }
    });

    // This month's earnings
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const thisMonthEarned = await prisma.walletTransaction.aggregate({
      where: {
        userId,
        type: 'DELIVERY_EARNED',
        createdAt: { gte: startOfMonth }
      },
      _sum: { amount: true }
    });

    return res.status(200).json({
      walletBalance: user.walletBalance,
      totalEarned: totalEarned._sum.amount || 0,
      pendingWithdrawals: pendingWithdrawals._sum.amount || 0,
      thisMonthEarned: thisMonthEarned._sum.amount || 0
    });
  } catch (error) {
    console.error('getWalletSummary error:', error);
    return res.status(500).json({ message: 'Error fetching wallet summary' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallet/transactions
// Returns the traveler's full transaction history
// ─────────────────────────────────────────────────────────────────────────────
export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;

    const transactions = await prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50 // Last 50 transactions
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
