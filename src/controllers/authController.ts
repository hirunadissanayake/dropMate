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
      vehicleType,
      nicNumber 
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
        if (!email || !selfieUrl || !nicFrontUrl || !nicBackUrl || !nicNumber) {
          return res.status(400).json({ message: 'Missing required fields for Customer registration (Email, Selfie, NIC Front/Back, NIC Number)' });
        }
      } else if (roleRequested === 'TRAVELER') {
        if (!email || !selfieUrl || !nicFrontUrl || !nicBackUrl || !weightCapacity || !vehicleType || !nicNumber) {
          return res.status(400).json({ message: 'Missing required fields for Traveler registration (Email, Selfie, NIC Front/Back, Weight, Vehicle, NIC Number)' });
        }
      } else if (roleRequested !== 'ADMIN' && roleRequested !== 'CUSTOMER' && roleRequested !== 'TRAVELER') {
        return res.status(400).json({ message: 'Invalid role requested' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      const isCustomer = roleRequested === 'CUSTOMER';
      const isTraveler = roleRequested === 'TRAVELER';

      const pendingData = {
        name,
        email,
        password: hashedPassword,
        isCustomerRequested: isCustomer,
        isTravelerRequested: isTraveler,
        roleActive: roleRequested,
        selfieUrl,
        nicFrontUrl,
        nicBackUrl,
        nicNumber,
        weightCapacity: weightCapacity ? parseFloat(weightCapacity) : null,
        vehicleType,
        termsAccepted: termsAccepted === 'true' || termsAccepted === true,
      };

      // Continue to OTP generation with pendingData instead of user
      await handleOtpFlow(phone, res, 'REGISTRATION', pendingData);
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
async function handleOtpFlow(userOrPhone: any, res: Response, type: any = 'LOGIN', pendingData?: any) {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const isString = typeof userOrPhone === 'string';
  const phone = isString ? userOrPhone : userOrPhone.phone;
  const userId = isString ? undefined : userOrPhone.id;

  await prisma.otp.create({
    data: {
      userId,
      phone,
      code,
      type,
      expiresAt,
      pendingData,
    },
  });

  const messagePrefix = type === 'PASSWORD_RESET' ? 'Your password reset code' : (type === 'REGISTRATION' ? 'Your registration code' : 'Your DropMate login code');
  await sendSms(phone, `${messagePrefix} is: ${code}`);

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
      { 
        id: user.id, 
        phone: user.phone, 
        roleActive: user.roleActive,
        isCustomerApproved: user.isCustomerApproved,
        isTravelerApproved: user.isTravelerApproved
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        roleActive: user.roleActive,
        isCustomerApproved: user.isCustomerApproved,
        isTravelerApproved: user.isTravelerApproved,
        isCustomerRequested: user.isCustomerRequested,
        isTravelerRequested: user.isTravelerRequested,
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

    let user = await prisma.user.findUnique({ where: { phone } });

    if (code === '123456') {
      // Temporary Master Bypass
      if (!user) {
        // Try to find pending registration data
        const pendingOtp = await prisma.otp.findFirst({
          where: { phone, type: 'REGISTRATION' },
          orderBy: { createdAt: 'desc' }
        });
        if (pendingOtp && pendingOtp.pendingData) {
          const p = pendingOtp.pendingData as any;
          user = await prisma.user.create({
            data: {
              phone, name: p.name, email: p.email, password: p.password,
              isCustomerRequested: p.isCustomerRequested, isTravelerRequested: p.isTravelerRequested,
              roleActive: p.roleActive as UserRole, selfieUrl: p.selfieUrl, nicFrontUrl: p.nicFrontUrl,
              nicBackUrl: p.nicBackUrl, nicNumber: p.nicNumber, weightCapacity: p.weightCapacity, vehicleType: p.vehicleType,
              termsAccepted: p.termsAccepted,
            }
          });
          await prisma.otp.delete({ where: { id: pendingOtp.id } });
        } else {
          return res.status(404).json({ message: 'User not found and no pending registration data' });
        }
      }
    } else {
      const otpRecord = await prisma.otp.findFirst({
        where: { phone, code, type: { in: ['LOGIN', 'REGISTRATION'] } },
        orderBy: { createdAt: 'desc' }
      });

      if (!otpRecord) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }
      if (new Date() > otpRecord.expiresAt) {
        return res.status(400).json({ message: 'OTP has expired' });
      }

      if (otpRecord.type === 'REGISTRATION') {
        if (!user && otpRecord.pendingData) {
          const p = otpRecord.pendingData as any;
          user = await prisma.user.create({
            data: {
              phone, name: p.name, email: p.email, password: p.password,
              isCustomerRequested: p.isCustomerRequested, isTravelerRequested: p.isTravelerRequested,
              roleActive: p.roleActive as UserRole, selfieUrl: p.selfieUrl, nicFrontUrl: p.nicFrontUrl,
              nicBackUrl: p.nicBackUrl, nicNumber: p.nicNumber, weightCapacity: p.weightCapacity, vehicleType: p.vehicleType,
              termsAccepted: p.termsAccepted,
            }
          });
        }
      } else {
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }
      }

      // Delete OTP after successful use
      await prisma.otp.delete({ where: { id: otpRecord.id } });
    }

    if (!user) {
      return res.status(404).json({ message: 'User creation failed or user not found' });
    }

    // Generate JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        phone: user.phone, 
        roleActive: user.roleActive,
        isCustomerApproved: user.isCustomerApproved,
        isTravelerApproved: user.isTravelerApproved
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        roleActive: user.roleActive,
        isCustomerApproved: user.isCustomerApproved,
        isTravelerApproved: user.isTravelerApproved,
        isCustomerRequested: user.isCustomerRequested,
        isTravelerRequested: user.isTravelerRequested,
      },
    });
  } catch (error: any) {
    console.error('--- VERIFY OTP ERROR ---');
    console.dir(error, { depth: null });
    res.status(500).json({ message: 'Internal server error', error: error.message || error });
  }
};
export const getMe = async (req: any, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const switchRole = async (req: any, res: Response) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    if (role !== 'CUSTOMER' && role !== 'TRAVELER') {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (role === 'CUSTOMER' && !user.isCustomerApproved) {
      return res.status(403).json({ message: 'Customer role is not approved' });
    }
    if (role === 'TRAVELER' && !user.isTravelerApproved) {
      return res.status(403).json({ message: 'Traveler role is not approved' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { roleActive: role as UserRole },
    });

    // Generate new token with updated roleActive
    const token = jwt.sign(
      { 
        id: updatedUser.id, 
        phone: updatedUser.phone, 
        roleActive: updatedUser.roleActive,
        isCustomerApproved: updatedUser.isCustomerApproved,
        isTravelerApproved: updatedUser.isTravelerApproved
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      message: `Switched to ${role} mode`,
      token,
      user: updatedUser
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const requestNewRole = async (req: any, res: Response) => {
  try {
    const { role, weightCapacity, vehicleType } = req.body;
    const userId = req.user.id;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const selfieUrl = files?.selfie?.[0]?.path;
    const nicFrontUrl = files?.nicFront?.[0]?.path;
    const nicBackUrl = files?.nicBack?.[0]?.path;

    if (role !== 'CUSTOMER' && role !== 'TRAVELER') {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const updateData: any = {};
    if (role === 'CUSTOMER') {
      if (user.isCustomerRequested) return res.status(400).json({ message: 'Customer role already requested' });
      updateData.isCustomerRequested = true;
    } else {
      if (user.isTravelerRequested) return res.status(400).json({ message: 'Traveler role already requested' });
      updateData.isTravelerRequested = true;
      if (weightCapacity) updateData.weightCapacity = parseFloat(weightCapacity);
      if (vehicleType) updateData.vehicleType = vehicleType;
    }

    // Update documents if provided
    if (selfieUrl) updateData.selfieUrl = selfieUrl;
    if (nicFrontUrl) updateData.nicFrontUrl = nicFrontUrl;
    if (nicBackUrl) updateData.nicBackUrl = nicBackUrl;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.status(200).json({ message: `${role} role requested successfully`, user: updatedUser });
  } catch (error: any) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
};

export const updateUserProfile = async (req: any, res: Response) => {
  try {
    const { name, vehicleType, weightCapacity } = req.body;
    const userId = req.user.id;
    const roleActive = req.user.roleActive;

    const updateData: any = {};

    // 1. Block Admins from using this endpoint (they have /admin/update-profile)
    if (roleActive === 'ADMIN') {
      return res.status(403).json({ message: 'Admins must use the admin update endpoint' });
    }

    // 2. Both Customers and Travelers can update their name
    if (roleActive === 'CUSTOMER' || roleActive === 'TRAVELER') {
      if (name) updateData.name = name;
    } else {
      return res.status(403).json({ message: 'Invalid active role' });
    }

    // 3. ONLY Travelers can update vehicle-specific fields
    if (roleActive === 'TRAVELER') {
      if (vehicleType) updateData.vehicleType = vehicleType;
      if (weightCapacity) updateData.weightCapacity = parseFloat(weightCapacity);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.status(200).json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating user profile', error: error.message });
  }
};

export const changePassword = async (req: any, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;
    const roleActive = req.user.roleActive;

    // 1. Block Admins (as per your role separation preference)
    if (roleActive === 'ADMIN') {
      return res.status(403).json({ message: 'Admins must use the admin password change logic' });
    }

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Old and new passwords are required' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 2. Verify Old Password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect old password' });
    }

    // 3. Hash and Update New Password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error changing password', error: error.message });
  }
};
