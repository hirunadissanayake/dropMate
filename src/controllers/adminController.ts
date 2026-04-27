import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createNotification } from './notificationController';


const prisma = new PrismaClient();

export const adminRegister = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, adminSecret } = req.body;

    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ message: 'Invalid Admin Secret Key' });
    }

    const existingAdmin = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] }
    });

    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin account already exists with this email or phone' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
        data: {
          name,
          email,
          phone,
          password: hashedPassword,
          roleActive: 'ADMIN',
          termsAccepted: true,
        },
    });

    res.status(201).json({ message: 'Admin registered successfully' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error registering admin', error: error.message });
  }
};

export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.roleActive !== 'ADMIN') {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone, roleActive: 'ADMIN' },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    res.status(200).json({
      token,
      user: { id: user.id, name: user.name, roleActive: 'ADMIN' },
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Login error', error: error.message });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    const user = await prisma.user.findFirst({
      where: { phone, roleActive: 'ADMIN' },
    });

    if (!user) {
      return res.status(404).json({ message: 'Admin account with this phone number not found' });
    }

    // Send Reset OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otp.create({
      data: {
        userId: user.id,
        code,
        type: 'PASSWORD_RESET' as any,
        expiresAt,
      },
    });

    console.log(`[SMS-SIMULATOR] Admin Password Reset Code for ${phone}: ${code}`);
    res.status(200).json({ message: 'Reset OTP sent to your phone' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error initiating password reset', error: error.message });
  }
};

export const verifyResetOtp = async (req: Request, res: Response) => {
  try {
    const { phone, code } = req.body;

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { 
        otps: { where: { code, type: 'PASSWORD_RESET' as any }, orderBy: { createdAt: 'desc' }, take: 1 } 
      },
    });

    if (!user || user.roleActive !== 'ADMIN') {
      return res.status(400).json({ message: 'Admin account not found' });
    }

    if (code === '123456') {
      // Temporary Master Bypass
    } else {
      if (user.otps.length === 0) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }

      if (new Date() > user.otps[0].expiresAt) {
        return res.status(400).json({ message: 'OTP has expired' });
      }

      // Delete the OTP after use
      await prisma.otp.delete({ where: { id: user.otps[0].id } });
    }

    const resetToken = jwt.sign(
      { id: user.id, purpose: 'ADMIN_PASSWORD_RESET' },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '15m' }
    );

    res.status(200).json({ resetToken, message: 'OTP verified' });
  } catch (error: any) {
    res.status(500).json({ message: 'Verification error', error: error.message });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { resetToken, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    const decoded: any = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret');
    if (decoded.purpose !== 'ADMIN_PASSWORD_RESET') throw new Error();

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: decoded.id },
      data: { password: hashedPassword },
    });

    res.status(200).json({ message: 'Admin password updated successfully' });
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired reset token' });
  }
};

export const getPendingUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { isCustomerRequested: true, isCustomerApproved: false },
          { isTravelerRequested: true, isTravelerApproved: false },
        ]
      },
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
};

export const approveUser = async (req: Request, res: Response) => {
  try {
    const { userId, role, approve } = req.body; // role: 'CUSTOMER' | 'TRAVELER', approve: boolean

    if (role !== 'CUSTOMER' && role !== 'TRAVELER') {
      return res.status(400).json({ message: 'Invalid role specified for approval' });
    }

    const updateData: any = {};
    if (role === 'CUSTOMER') {
      updateData.isCustomerApproved = approve;
      if (!approve) updateData.isCustomerRequested = false;
    } else {
      updateData.isTravelerApproved = approve;
      if (!approve) updateData.isTravelerRequested = false;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    // Send Notification
    await createNotification({
      userId: user.id,
      type: approve ? 'PROFILE_APPROVED' : 'PROFILE_REJECTED',
      title: approve ? 'Profile Approved! 🎉' : 'Profile Update',
      body: approve 
        ? `Congratulations! Your ${role.toLowerCase()} profile has been verified. You can now use all features.`
        : `Your ${role.toLowerCase()} profile request was not approved at this time. Please contact support.`,
      metadata: { role, approve }
    });


    res.status(200).json({ 
      message: `User ${role} role ${approve ? 'approved' : 'rejected'}`,
      user 
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating user status', error: error.message });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
};

export const getAllParcelsAdmin = async (req: Request, res: Response) => {
  try {
    const parcels = await prisma.parcel.findMany({
      include: {
        sender: { select: { id: true, name: true, phone: true } },
        matchedTrip: {
          include: {
            traveler: { select: { id: true, name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(parcels);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching parcels', error: error.message });
  }
};

export const getAllTripsAdmin = async (req: Request, res: Response) => {
  try {
    const trips = await prisma.trip.findMany({
      include: {
        traveler: { select: { id: true, name: true, phone: true } },
        parcels: {
          include: {
            sender: { select: { id: true, name: true, phone: true } },
          }
        },
        _count: {
          select: { parcels: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(trips);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching trips', error: error.message });
  }
};

export const getApprovedCustomers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { isCustomerApproved: true },
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching customers' });
  }
};

export const getApprovedTravelers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { isTravelerApproved: true },
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching travelers' });
  }
};

export const getAdminMe = async (req: any, res: Response) => {
  try {
    const admin = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!admin || admin.roleActive !== 'ADMIN') {
      return res.status(404).json({ message: 'Admin not found' });
    }

    res.status(200).json(admin);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching admin profile', error: error.message });
  }
};

export const updateAdminProfile = async (req: any, res: Response) => {
  try {
    const { name } = req.body;
    const adminId = req.user.id;

    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const updatedAdmin = await prisma.user.update({
      where: { id: adminId },
      data: { name }, 
    });

    res.status(200).json({ message: 'Admin profile updated successfully', admin: updatedAdmin });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating admin profile', error: error.message });
  }
};

export const getWalletStatsAdmin = async (req: Request, res: Response) => {
  try {
    // 1. Total Platform Earnings (Sum of platform fees from delivered parcels)
    const platformEarnings = await prisma.parcel.aggregate({
      where: { status: 'DELIVERED' },
      _sum: { platformFee: true }
    });

    // 2. Total Traveler Payouts (Sum of traveler payouts from delivered parcels)
    const travelerPayouts = await prisma.parcel.aggregate({
      where: { status: 'DELIVERED' },
      _sum: { travelerPayout: true }
    });

    // 3. Pending Withdrawals
    const pendingWithdrawals = await prisma.walletTransaction.aggregate({
      where: { status: 'PENDING', type: 'WITHDRAWAL' },
      _sum: { amount: true },
      _count: true
    });

    res.status(200).json({
      totalPlatformEarnings: platformEarnings._sum.platformFee || 0,
      totalTravelerEarnings: travelerPayouts._sum.travelerPayout || 0,
      pendingWithdrawalAmount: pendingWithdrawals._sum.amount || 0,
      pendingWithdrawalCount: pendingWithdrawals._count || 0
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching wallet stats', error: error.message });
  }
};

export const getAllTransactionsAdmin = async (req: Request, res: Response) => {
  try {
    const transactions = await prisma.walletTransaction.findMany({
      include: {
        user: { 
          select: { 
            id: true, 
            name: true, 
            phone: true, 
            walletBalance: true,
            walletTransactions: {
              where: { type: 'WITHDRAWAL', status: 'PENDING' },
              select: { amount: true }
            }
          } 
        },
        parcel: { select: { id: true, price: true, platformFee: true, travelerPayout: true, fromLocation: true, toLocation: true } }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Map to include calculated real balance
    const mappedTransactions = transactions.map(tx => {
      const pendingSum = tx.user.walletTransactions.reduce((sum: number, wtx: any) => sum + wtx.amount, 0);
      const { walletTransactions, ...userData } = tx.user;
      return {
        ...tx,
        user: {
          ...userData,
          pendingSum,
          realBalance: userData.walletBalance + pendingSum
        }
      };
    });

    res.status(200).json(mappedTransactions);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching transactions', error: error.message });
  }
};

export const updateTransactionStatus = async (req: Request, res: Response) => {
  try {
    const { transactionId, status } = req.body; // status: 'COMPLETED' | 'FAILED'

    if (status !== 'COMPLETED' && status !== 'FAILED') {
      return res.status(400).json({ message: 'Invalid status. Must be COMPLETED or FAILED.' });
    }

    const transaction = await prisma.walletTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (transaction.status !== 'PENDING') {
      return res.status(400).json({ message: 'Only PENDING transactions can be updated.' });
    }

    if (status === 'FAILED') {
      // If failed, refund the amount back to user's wallet
      await prisma.$transaction([
        prisma.walletTransaction.update({
          where: { id: transactionId },
          data: { status: 'FAILED' },
        }),
        prisma.user.update({
          where: { id: transaction.userId },
          data: { walletBalance: { increment: transaction.amount } },
        }),
      ]);
      
      // Notify User
      await createNotification({
        userId: transaction.userId,
        type: 'WITHDRAWAL_REJECTED',
        title: 'Withdrawal Failed',
        body: `Your withdrawal of LKR ${transaction.amount.toFixed(2)} could not be processed. The funds have been returned to your wallet.`,
        metadata: { transactionId, amount: transaction.amount }
      });

    } else {
      // COMPLETED
      await prisma.walletTransaction.update({
        where: { id: transactionId },
        data: { status: 'COMPLETED' },
      });

      // Notify User
      await createNotification({
        userId: transaction.userId,
        type: 'WITHDRAWAL_APPROVED',
        title: 'Withdrawal Successful! ✅',
        body: `Your withdrawal of LKR ${transaction.amount.toFixed(2)} has been processed successfully.`,
        metadata: { transactionId, amount: transaction.amount }
      });
    }

    res.status(200).json({ message: `Transaction marked as ${status}` });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating transaction status', error: error.message });
  }
};

export const globalSearch = async (req: Request, res: Response) => {
  try {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(200).json({ users: [], parcels: [], trips: [] });
    }

    const [users, parcels, trips] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
          roleActive: { not: 'ADMIN' }
        },
        take: 5,
        select: { id: true, name: true, phone: true, roleActive: true }
      }),
      prisma.parcel.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { fromLocation: { contains: query, mode: 'insensitive' } },
            { toLocation: { contains: query, mode: 'insensitive' } },
          ]
        },
        take: 5,
        select: { id: true, fromLocation: true, toLocation: true, status: true }
      }),
      prisma.trip.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { fromLocation: { contains: query, mode: 'insensitive' } },
            { toLocation: { contains: query, mode: 'insensitive' } },
          ]
        },
        take: 5,
        select: { id: true, fromLocation: true, toLocation: true, status: true }
      })
    ]);

    res.status(200).json({ users, parcels, trips });
  } catch (error: any) {
    res.status(500).json({ message: 'Search error', error: error.message });
  }
};

export const getSupportChatUsers = async (req: Request, res: Response) => {
  try {
    // Get unique userIds from SupportMessage table
    const chats = await prisma.supportMessage.findMany({
      distinct: ['userId'],
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        message: true,
        createdAt: true,
        isAdmin: true,
      }
    });

    // Fetch user details for each unique userId
    const usersWithLastMsg = await Promise.all(chats.map(async (chat) => {
      const user = await prisma.user.findUnique({
        where: { id: chat.userId },
        select: { id: true, name: true, phone: true, selfieUrl: true }
      });
      
      // Count unread messages for this user (where isAdmin is false and isRead is false)
      const unreadCount = await prisma.supportMessage.count({
        where: { userId: chat.userId, isAdmin: false, isRead: false }
      });

      return {
        ...user,
        lastMessage: chat.message,
        lastMessageAt: chat.createdAt,
        unreadCount
      };
    }));

    res.status(200).json(usersWithLastMsg);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching support chats', error: error.message });
  }
};
