import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateOtp, sendSms } from '../utils/otpUtils';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

// 1. MATCHING: Traveler requests to carry a parcel
export const requestMatch = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId, tripId } = req.body;
    
    // Calculate a simple score based on matching locations (Production would use a better algorithm)
    const match = await prisma.match.create({
      data: {
        parcelId,
        tripId,
        senderId: (await prisma.parcel.findUnique({ where: { id: parcelId } }))?.senderId || '',
        travelerId: req.user.id,
        score: 100, // Placeholder
        status: 'PENDING'
      }
    });

    res.status(201).json(match);
  } catch (error) {
    res.status(500).json({ message: 'Error creating match request' });
  }
};

// 2. PICKUP OTP: Traveler initiates pickup
export const initiatePickup = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.body;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, include: { sender: true } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    // Generate OTP for SENDER
    const code = generateOtp();
    await prisma.otp.create({
      data: { userId: parcel.senderId, code, type: 'PICKUP', expiresAt: new Date(Date.now() + 30 * 60 * 1000) }
    });

    await sendSms(parcel.sender.phone, `DropMate: Give this PICKUP code to your traveler: ${code}`);

    res.status(200).json({ message: 'Pickup OTP sent to sender' });
  } catch (error) {
    res.status(500).json({ message: 'Error initiating pickup' });
  }
};

// 3. VERIFY PICKUP: Traveler enters OTP from Sender
export const verifyPickup = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId, code } = req.body;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    if (code === '123456') {
      // Master Bypass
    } else {
      const otp = await prisma.otp.findFirst({
        where: { userId: parcel.senderId, code, type: 'PICKUP' }
      });

      if (!otp) return res.status(400).json({ message: 'Invalid OTP' });
      await prisma.otp.delete({ where: { id: otp.id } });
    }

    await prisma.parcel.update({
      where: { id: parcelId },
      data: { status: 'PICKED_UP' }
    });

    res.status(200).json({ message: 'Parcel picked up successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying pickup' });
  }
};

// 4. DELIVERY OTP: Traveler initiates delivery to Receiver (No account needed)
export const initiateDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.body;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    const code = generateOtp();
    // Use the sender's ID as the owner in DB but send it to Receiver's phone
    await prisma.otp.create({
      data: { userId: parcel.senderId, code, type: 'DELIVERY', expiresAt: new Date(Date.now() + 30 * 60 * 1000) }
    });

    await sendSms(parcel.receiverPhone, `DropMate: Give this DELIVERY code to the traveler ${code} to receive your parcel.`);

    res.status(200).json({ message: 'Delivery OTP sent to receiver' });
  } catch (error) {
    res.status(500).json({ message: 'Error initiating delivery' });
  }
};

// 5. VERIFY DELIVERY: Traveler enters OTP from Receiver
export const verifyDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId, code } = req.body;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    if (code === '123456') {
      // Master Bypass
    } else {
      const otp = await prisma.otp.findFirst({
        where: { userId: parcel.senderId, code, type: 'DELIVERY' }
      });

      if (!otp) return res.status(400).json({ message: 'Invalid OTP' });
      await prisma.otp.delete({ where: { id: otp.id } });
    }

    await prisma.parcel.update({
      where: { id: parcelId },
      data: { status: 'DELIVERED' }
    });

    res.status(200).json({ message: 'Parcel delivered! Transaction complete.' });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying delivery' });
  }
};
