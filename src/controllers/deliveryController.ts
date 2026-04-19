import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateOtp, sendSms } from '../utils/otpUtils';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

/**
 * 1. MATCHING: Unified request (Customer or Traveler can initiate)
 * POST /api/delivery/match-request
 */
export const requestMatch = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId, tripId } = req.body;
    const userId = req.user.id;

    // Fetch parcel and trip to verify ownership
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });

    if (!parcel || !trip) {
      return res.status(404).json({ message: 'Parcel or Trip not found' });
    }

    // Verify if already matched
    const existingMatch = await prisma.match.findFirst({
      where: { parcelId, tripId, status: { not: 'REJECTED' } }
    });
    if (existingMatch) {
      return res.status(400).json({ message: 'A match request already exists' });
    }

    // Determine who is requesting
    const isSender = parcel.senderId === userId;
    const isTraveler = trip.travelerId === userId;

    if (!isSender && !isTraveler) {
      return res.status(403).json({ message: 'Unauthorized to request this match. You must be the parcel owner or the trip traveler.' });
    }

    // Check if trip has enough capacity (Preliminary check)
    if (trip.usedCapacity + parcel.weight > trip.capacityKg) {
      return res.status(400).json({ message: 'Trip does not have enough capacity for this parcel' });
    }

    const match = await prisma.match.create({
      data: {
        parcelId,
        tripId,
        senderId: parcel.senderId,
        travelerId: trip.travelerId,
        score: 100, // TODO: Implement real scoring logic
        status: 'PENDING'
      }
    });

    res.status(201).json({ message: 'Match request sent', match });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating match request' });
  }
};

/**
 * 2. GET PENDING MATCHES: View requests waiting for YOUR approval
 * GET /api/delivery/pending-matches
 */
export const getPendingMatches = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const roleActive = req.user.roleActive;

    const matches = await prisma.match.findMany({
      where: {
        status: 'PENDING',
        ...(roleActive === 'TRAVELER' 
          ? { travelerId: userId } 
          : { senderId: userId }
        )
      },
      include: {
        parcel: { include: { sender: { select: { name: true, phone: true } } } },
        trip: { include: { traveler: { select: { name: true, rating: true } } } },
        sender: { select: { name: true, phone: true } }
      }
    });

    res.status(200).json(matches);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching pending matches' });
  }
};

/**
 * 3. ACCEPT MATCH: Confirm assignment
 * PATCH /api/delivery/match/:id/accept
 */
export const acceptMatch = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user.id;

    const match = await prisma.match.findUnique({
      where: { id: id },
      include: { parcel: true, trip: true }
    });

    if (!match || match.status !== 'PENDING') {
      return res.status(404).json({ message: 'Pending match not found' });
    }

    // Check if the current user is the "other party" (authorized to accept)
    // For now, we allow either party to accept if the logic in the app ensures only the non-requester sees the button.
    // To be strict, you'd need "requesterId" in the Match model.
    if (match.senderId !== userId && match.travelerId !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Final Capacity Check
    const trip = match.trip;
    const parcel = match.parcel;
    if (trip.usedCapacity + parcel.weight > trip.capacityKg) {
      return res.status(400).json({ message: 'Cannot accept: Trip capacity exceeded' });
    }

    // ATOMIC TRANSACTION: Update status, link IDs, and update capacity
    await prisma.$transaction([
      // 1. Update Match status
      prisma.match.update({ where: { id: id }, data: { status: 'ACCEPTED' } }),
      // 2. Link parcel to trip and update parcel status
      prisma.parcel.update({
        where: { id: parcel.id },
        data: { matchedTripId: trip.id, status: 'MATCHED' }
      }),
      // 3. Increment trip usedCapacity
      prisma.trip.update({
        where: { id: trip.id },
        data: { usedCapacity: { increment: parcel.weight } }
      })
    ]);

    res.status(200).json({ message: 'Match accepted and capacity updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error accepting match' });
  }
};

/**
 * 4. REJECT MATCH
 * PATCH /api/delivery/match/:id/reject
 */
export const rejectMatch = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user.id;

    const match = await prisma.match.findUnique({ where: { id: id } });

    if (!match || match.senderId !== userId && match.travelerId !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await prisma.match.update({
      where: { id: id },
      data: { status: 'REJECTED' }
    });

    res.status(200).json({ message: 'Match request rejected' });
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting match' });
  }
};

// 5. PICKUP OTP: Traveler initiates pickup
export const initiatePickup = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.body;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, include: { sender: true } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });
    if (parcel.status !== 'MATCHED') return res.status(400).json({ message: 'Parcel is not matched to a trip yet' });

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

// 6. VERIFY PICKUP: Traveler enters OTP from Sender
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

// 7. DELIVERY OTP: Traveler initiates delivery to Receiver
export const initiateDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.body;
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    const code = generateOtp();
    await prisma.otp.create({
      data: { userId: parcel.senderId, code, type: 'DELIVERY', expiresAt: new Date(Date.now() + 30 * 60 * 1000) }
    });

    await sendSms(parcel.receiverPhone, `DropMate: Give this DELIVERY code to the traveler ${code} to receive your parcel.`);

    res.status(200).json({ message: 'Delivery OTP sent to receiver' });
  } catch (error) {
    res.status(500).json({ message: 'Error initiating delivery' });
  }
};

// 8. VERIFY DELIVERY: Traveler enters OTP from Receiver
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

    // ATOMIC: Finish parcel, finish match, and maybe free capacity? 
    // Usually capacity stays "used" until the trip is completed, but let's just finish the parcel.
    await prisma.parcel.update({
      where: { id: parcelId },
      data: { status: 'DELIVERED' }
    });

    res.status(200).json({ message: 'Parcel delivered! Transaction complete.' });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying delivery' });
  }
};
