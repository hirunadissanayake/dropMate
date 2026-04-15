import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

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
        roleRequested: 'ADMIN',
        roleActive: 'ADMIN',
        status: 'APPROVED',
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

    if (!user || user.roleRequested !== 'ADMIN') {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: 'ADMIN', status: user.status },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    res.status(200).json({
      token,
      user: { id: user.id, name: user.name, role: 'ADMIN' },
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
      where: { phone, roleRequested: 'ADMIN' },
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

    if (!user || user.roleRequested !== 'ADMIN') {
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
      where: { status: 'PENDING' },
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
};

export const approveUser = async (req: Request, res: Response) => {
  try {
    const { userId, approve } = req.body; // approve: boolean

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        roleActive: approve ? undefined : null, // keep the role they requested if approved
      },
    });

    res.status(200).json({ message: `User ${user.status}` });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user status' });
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
