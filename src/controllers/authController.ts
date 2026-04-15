import { Request, Response } from 'express';
import { PrismaClient, UserRole } from '@prisma/client';
import { generateOtp, sendSms } from '../utils/otpUtils';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const requestOtp = async (req: Request, res: Response) => {
  try {
    const { 
      phone, 
      name, 
      email, 
      password,
      confirmPassword,
      roleRequested, 
      termsAccepted,
      weightCapacity,
      vehicleType 
    } = req.body;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const selfieUrl = files?.selfie?.[0]?.path;
    const nicFrontUrl = files?.nicFront?.[0]?.path;
    const nicBackUrl = files?.nicBack?.[0]?.path;

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    // 1. Check for existing User
    const existingUserByPhone = await prisma.user.findUnique({
      where: { phone },
    });

    // If user exists and this is a registration attempt (files are provided or name is provided)
    if (existingUserByPhone && (name || roleRequested)) {
      return res.status(400).json({ message: 'An account with this phone number already exists. Please log in.' });
    }

    if (!existingUserByPhone) {
      // Check for existing email if provided
      if (email) {
        const existingUserByEmail = await prisma.user.findFirst({
          where: { email },
        });
        if (existingUserByEmail) {
          return res.status(400).json({ message: 'An account with this email already exists.' });
        }
      }

      // Validation for new users
      if (!name || !roleRequested || !termsAccepted || !password || !confirmPassword) {
        return res.status(400).json({ message: 'Name, Role, Password, and Terms acceptance are required for new users' });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({ message: 'Passwords do not match' });
      }

      if (roleRequested === 'CUSTOMER') {
        if (!email || !selfieUrl || !nicFrontUrl || !nicBackUrl) {
          return res.status(400).json({ message: 'Missing required fields for Customer registration (Email, Selfie, NIC Front/Back)' });
        }
      } else if (roleRequested === 'TRAVELER') {
        if (!email || !selfieUrl || !nicFrontUrl || !nicBackUrl || !weightCapacity || !vehicleType) {
          return res.status(400).json({ message: 'Missing required fields for Traveler registration (Email, Selfie, NIC Front/Back, Weight, Vehicle)' });
        }
      } else if (roleRequested !== 'ADMIN' && roleRequested !== 'CUSTOMER' && roleRequested !== 'TRAVELER') {
        return res.status(400).json({ message: 'Invalid role requested' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          phone,
          name,
          email,
          password: hashedPassword,
          roleRequested: roleRequested as UserRole,
          selfieUrl,
          nicFrontUrl,
          nicBackUrl,
          weightCapacity: weightCapacity ? parseFloat(weightCapacity) : null,
          vehicleType,
          termsAccepted: termsAccepted === 'true' || termsAccepted === true,
        },
      });

      // Continue to OTP generation with the new user
      await handleOtpFlow(user, res, 'LOGIN');
    } else {
      // If user exists and this is just a login attempt (phone only)
      await handleOtpFlow(existingUserByPhone, res, 'LOGIN');
    }
  } catch (error: any) {
    console.error('--- REQUEST OTP ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      return res.status(404).json({ message: 'User with this phone number not found' });
    }

    // Send Password Reset OTP
    await handleOtpFlow(user, res, 'PASSWORD_RESET');
  } catch (error: any) {
    console.error('--- FORGOT PASSWORD ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};

export const verifyResetOtp = async (req: Request, res: Response) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Phone and code are required' });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { 
        otps: { 
          where: { code, type: 'PASSWORD_RESET' as any }, 
          orderBy: { createdAt: 'desc' }, 
          take: 1 
        } 
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'User with this phone number not found' });
    }

    if (code === '123456') {
      // Temporary Master Bypass
    } else {
      if (user.otps.length === 0) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }
      const otp = user.otps[0];
      if (new Date() > otp.expiresAt) {
        return res.status(400).json({ message: 'OTP has expired' });
      }
      // Delete OTP after successful verification
      await prisma.otp.delete({ where: { id: otp.id } });
    }

    // Generate a temporary Reset Token (valid for 15 minutes)
    const resetToken = jwt.sign(
      { phone: user.phone, purpose: 'PASSWORD_RESET' },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '15m' }
    );

    res.status(200).json({ 
      message: 'OTP verified. You can now reset your password.',
      resetToken 
    });
  } catch (error: any) {
    console.error('--- VERIFY RESET OTP ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { resetToken, password, confirmPassword } = req.body;

    if (!resetToken || !password || !confirmPassword) {
      return res.status(400).json({ message: 'Reset token and passwords are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    // Verify the Reset Token
    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret');
      if (decoded.purpose !== 'PASSWORD_RESET') throw new Error('Invalid token purpose');
    } catch (err) {
      return res.status(401).json({ message: 'Invalid or expired reset token' });
    }

    // Find user by phone from token
    const user = await prisma.user.findUnique({
      where: { phone: decoded.phone },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.status(200).json({ message: 'Password reset successfully. Please log in with your new password.' });
  } catch (error: any) {
    console.error('--- RESET PASSWORD ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};

// Helper function to handle OTP creation and sending
async function handleOtpFlow(user: any, res: Response, type: any = 'LOGIN') {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.otp.create({
    data: {
      userId: user.id,
      code,
      type,
      expiresAt,
    },
  });

  const messagePrefix = type === 'PASSWORD_RESET' ? 'Your password reset code' : 'Your DropMate login code';
  await sendSms(user.phone, `${messagePrefix} is: ${code}`);

  res.status(200).json({ message: 'OTP sent successfully' });
}

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await prisma.user.findFirst({
      where: { email },
    });

    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.roleActive || user.roleRequested, status: user.status },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.roleActive || user.roleRequested,
        status: user.status,
      },
    });
  } catch (error: any) {
    console.error('--- LOGIN ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'Phone and code are required' });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { otps: { where: { code, type: 'LOGIN' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (code === '123456') {
      // Temporary Master Bypass
    } else {
      if (user.otps.length === 0) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }
      const otp = user.otps[0];
      if (new Date() > otp.expiresAt) {
        return res.status(400).json({ message: 'OTP has expired' });
      }
      // Delete OTP after successful use
      await prisma.otp.delete({ where: { id: otp.id } });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.roleActive || user.roleRequested, status: user.status },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.roleActive || user.roleRequested,
        status: user.status,
      },
    });
  } catch (error: any) {
    console.error('--- VERIFY OTP ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};
