import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateOtp, sendSms } from '../utils/otpUtils';
import { createNotification } from './notificationController';
import { io } from '../index';


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
    const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, include: { category: true } });
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });

    if (!parcel || !trip) {
      return res.status(404).json({ message: 'Parcel or Trip not found' });
    }

    // Check for existing match (same parcel + same trip)
    const existingMatch = await prisma.match.findFirst({
      where: { parcelId, tripId }
    });

    if (existingMatch) {
      if (existingMatch.status === 'PENDING') {
        return res.status(400).json({ message: 'A delivery request is already pending for this traveler.' });
      }
      if (['ACCEPTED', 'MATCHED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(existingMatch.status)) {
        return res.status(400).json({ message: 'This parcel is already matched with this traveler.' });
      }
      if (existingMatch.status === 'REJECTED') {
        return res.status(400).json({ message: 'This traveler has already declined your delivery request.' });
      }
      // If CANCELLED or EXPIRED, we allow creating a NEW match record later in the code.
      // However, to keep history clean, we'll actually DELETE the cancelled/expired record first 
      // or just update it. Actually, create new is fine but let's delete the old one to avoid 
      // unique constraint issues if we add them later, and keep DB clean.
      if (['CANCELLED', 'EXPIRED'].includes(existingMatch.status)) {
        await prisma.match.delete({ where: { id: existingMatch.id } });
      }
    }

    // OPTION 1 LOCK: Block if sender already has ANY OTHER pending request for this parcel
    const existingPendingForParcel = await prisma.match.findFirst({
      where: { 
        parcelId, 
        status: 'PENDING',
        // Exclude the one we might have just checked if we didn't delete it
      }
    });

    if (existingPendingForParcel) {
      return res.status(400).json({
        message: 'You already have a pending request for this parcel with another traveler. Cancel it first to request someone else.'
      });
    }

    // Determine who is requesting
    const isSender = parcel.senderId === userId;
    const isTraveler = trip.travelerId === userId;

    if (!isSender && !isTraveler) {
      return res.status(403).json({ message: 'Unauthorized to request this match. You must be the parcel owner or the trip traveler.' });
    }

    // Check if trip has enough capacity (Preliminary check)
    // Fixed-fare parcels (e.g. Vehicle) have no weight and don't count against kg capacity
    if (trip.usedCapacity + (parcel.weight ?? 0) > trip.capacityKg) {
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

    // Send notification to the other party
    const targetUserId = isSender ? trip.travelerId : parcel.senderId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const requesterName = user?.name || 'A user';
    const notificationTitle = 'New Delivery Request';
    const notificationBody = isSender 
      ? `${requesterName} wants to deliver their parcel "${parcel.name || 'Package'}" on your trip from ${trip.fromLocation} to ${trip.toLocation}.`
      : `${requesterName} wants to deliver your parcel "${parcel.name || 'Package'}" on their trip from ${trip.fromLocation} to ${trip.toLocation}.`;

    const requester = await prisma.user.findUnique({ where: { id: userId } });
    const requesterRating = requester?.roleActive === 'TRAVELER' ? requester.travelerRating : (requester?.customerRating || 0);

    await createNotification({
      userId: targetUserId,
      type: 'DELIVERY_REQUEST',
      title: notificationTitle,
      body: notificationBody,
      metadata: { 
        matchId: match.id, 
        parcelId, 
        tripId,
        parcelTitle: parcel.name || 'New Parcel',
        parcelWeight: parcel.weight,
        parcelCategory: parcel.category?.name || null,
        fromLocation: parcel.fromLocation,
        toLocation: parcel.toLocation,
        senderName: requesterName,
        senderRating: requesterRating?.toString() || '0',
        offerPrice: parcel.price,
        imageUrls: parcel.imageUrls ? JSON.stringify(parcel.imageUrls) : '[]',
        createdAt: match.createdAt.toISOString()
      }
    });

    res.status(201).json({ message: 'Delivery request sent', match });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating delivery request' });
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
        parcel: { include: { sender: { select: { id: true, name: true, phone: true, travelerRating: true, customerRating: true } }, category: true } },
        trip: { 
          include: { 
            traveler: { select: { id: true, name: true, travelerRating: true, customerRating: true, selfieUrl: true } }
          } 
        },
        sender: { select: { id: true, name: true, phone: true, travelerRating: true, customerRating: true } }
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
    const userId = req.user.id as string;

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
    // Fixed-fare parcels (e.g. Vehicle) have no weight and don't count against kg capacity
    const trip = match.trip;
    const parcel = match.parcel;
    const parcelWeight = parcel.weight ?? 0;
    if (trip.usedCapacity + parcelWeight > trip.capacityKg) {
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
        data: { usedCapacity: { increment: parcelWeight } }
      })
    ]);

    // Notify the other party
    const targetUserId = match.senderId === userId ? match.travelerId : match.senderId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const requesterName = user?.name || 'A user';
    await createNotification({
      userId: targetUserId,
      type: 'PARCEL_ACCEPTED',
      title: 'Delivery Request Accepted! 🎉',
      body: `${requesterName} has accepted your delivery request for "${parcel.name || 'your parcel'}". You can now proceed with the delivery.`,
      metadata: { matchId: id, parcelId: parcel.id, tripId: trip.id }
    });
    
    // Notify admins via socket
    try {
      io.to('admins').emit('new_notification', {
        id: `match-${id}`,
        title: 'Parcel Matched! 📦',
        body: `Parcel "${parcel.name || 'Package'}" from ${parcel.fromLocation} to ${parcel.toLocation} has been matched with a trip.`,
        type: 'PARCEL_MATCHED',
        metadata: { 
          matchId: id, 
          parcelId: parcel.id, 
          tripId: trip.id,
          fromLocation: parcel.fromLocation,
          toLocation: parcel.toLocation,
          weight: parcel.weight,
          price: parcel.price
        },
        createdAt: new Date().toISOString(),
        isRead: false
      });
      console.log(`Admin notification emitted for match ${id}`);
    } catch (socketError) {
      console.error('Failed to emit admin notification:', socketError);
    }

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
    const userId = req.user.id as string;

    const match = await prisma.match.findUnique({ 
      where: { id: id },
      include: { parcel: true }
    });

    if (!match || match.senderId !== userId && match.travelerId !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { reason } = req.body;

    await prisma.match.update({
      where: { id: id },
      data: { status: 'REJECTED' }
    });

    // Notify the other party
    const targetUserId = match.senderId === userId ? match.travelerId : match.senderId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const requesterName = user?.name || 'A user';
    
    const reasonText = reason ? ` Reason: ${reason}` : '';

    await createNotification({
      userId: targetUserId,
      type: 'PARCEL_REJECTED',
      title: 'Delivery Request Declined',
      body: `${requesterName} has declined your delivery request for "${match.parcel?.name || 'your parcel'}".${reasonText}`,
      metadata: { matchId: id, reason }
    });

    res.status(200).json({ message: 'Delivery request rejected' });
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting match' });
  }
};

/**
 * 5. EXPIRE MATCH: Called when the 10-minute timer runs out
 * PATCH /api/delivery/match/:id/expire
 */
export const expireMatch = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user.id as string;

    const match = await prisma.match.findUnique({ 
      where: { id },
      include: { parcel: true }
    });

    if (!match) return res.status(404).json({ message: 'Match not found' });

    // Only the traveler can trigger the expiration (it's their timer)
    if (match.travelerId !== userId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (match.status !== 'PENDING') {
      return res.status(400).json({ message: 'Match is already processed' });
    }

    await prisma.match.update({
      where: { id },
      data: { status: 'REJECTED' } // We mark it as rejected (expired)
    });

    // Notify the sender (Customer)
    const traveler = await prisma.user.findUnique({ where: { id: userId } });
    await createNotification({
      userId: match.senderId,
      type: 'MATCH_EXPIRED',
      title: 'Delivery Request Expired',
      body: `${traveler?.name || 'The traveler'} did not respond to your request for "${match.parcel?.name || 'your parcel'}" in time. You can try matching with someone else.`,
      metadata: { matchId: id, status: 'EXPIRED' }
    });

    res.status(200).json({ message: 'Match expired' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error expiring match' });
  }
};

// 5. PICKUP OTP: Traveler initiates pickup
export const initiatePickup = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.body;
    const pId = parcelId as string;
    const parcel = await prisma.parcel.findUnique({ where: { id: pId }, include: { sender: true } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });
    if (parcel.status !== 'MATCHED') return res.status(400).json({ message: 'Parcel is not matched to a trip yet' });

    // Generate OTP for SENDER
    const code = generateOtp();
    await prisma.otp.create({
      data: { userId: parcel.senderId, phone: parcel.sender.phone, code, type: 'PICKUP', expiresAt: new Date(Date.now() + 30 * 60 * 1000) }
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
    const pId = parcelId as string;
    const parcel = await prisma.parcel.findUnique({ where: { id: pId } });

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

    // Check if online payment is completed if method is ONLINE
    if (parcel.paymentMethod === 'ONLINE' && parcel.paymentStatus !== 'PAID') {
      return res.status(400).json({ message: 'Payment must be completed before pickup for online payments' });
    }

    // If CASH_ON_PICKUP → mark as PAID when pickup is confirmed
    const isPickupCash = parcel.paymentMethod === 'CASH_ON_PICKUP';

    await prisma.parcel.update({
      where: { id: parcelId },
      data: { 
        status: 'PICKED_UP',
        paymentStatus: isPickupCash ? 'PAID' : parcel.paymentStatus
      }
    });

    // Notify the sender
    await createNotification({
      userId: parcel.senderId,
      type: 'PARCEL_PICKED_UP',
      title: 'Parcel Picked Up 📦',
      body: `Your parcel "${parcel.name || 'Package'}" has been picked up by the traveler.`,
      metadata: { parcelId: pId }
    });

    res.status(200).json({
      message: isPickupCash
        ? 'Parcel picked up & cash collected. Payment confirmed!'
        : 'Parcel picked up successfully.'
    });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying pickup' });
  }
};

// 7. DELIVERY OTP: Traveler initiates delivery to Receiver
export const initiateDelivery = async (req: AuthRequest, res: Response) => {
  try {
    const { parcelId } = req.body;
    const pId = parcelId as string;
    const parcel = await prisma.parcel.findUnique({ where: { id: pId } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    const code = generateOtp();
    await prisma.otp.create({
      data: { 
        phone: parcel.receiverPhone, // Use receiver phone instead of senderId
        code, 
        type: 'DELIVERY', 
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) 
      }
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
    const pId = parcelId as string;
    const parcel = await prisma.parcel.findUnique({ where: { id: pId } });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });

    if (code === '123456') {
      // Master Bypass
    } else {
      const otp = await prisma.otp.findFirst({
        where: { phone: parcel.receiverPhone, code, type: 'DELIVERY' } // Search by phone
      });

      if (!otp) return res.status(400).json({ message: 'Invalid OTP' });
      await prisma.otp.delete({ where: { id: otp.id } });
    }

    // ATOMIC: Finish parcel and handle payment
    // CASH_ON_DELIVERY → mark PAID on delivery
    // CASH_ON_PICKUP   → already PAID at pickup, just mark DELIVERED
    // ONLINE           → already PAID before pickup, just mark DELIVERED
    const isDeliveryCash = parcel.paymentMethod === 'CASH_ON_DELIVERY';

    // Fetch the matched trip to find the traveler ID
    const matchedTrip = parcel.matchedTripId
      ? await prisma.trip.findUnique({ where: { id: parcel.matchedTripId } })
      : null;

    const travelerPayout = parcel.travelerPayout || 0;

    // Build atomic operations
    const operations: any[] = [
      // 1. Mark parcel as DELIVERED
      prisma.parcel.update({
        where: { id: pId },
        data: {
          status: 'DELIVERED',
          paymentStatus: isDeliveryCash ? 'PAID' : parcel.paymentStatus
        }
      })
    ];

    const platformFee = parcel.platformFee || 0;
    const isOnline = parcel.paymentMethod === 'ONLINE';

    // 2. If there is a traveler, adjust their wallet balance
    if (matchedTrip) {
      if (isOnline) {
        // CASE 1: ONLINE — Platform has the money, we owe the traveler their payout
        operations.push(
          prisma.user.update({
            where: { id: matchedTrip.travelerId },
            data: { walletBalance: { increment: travelerPayout } }
          }),
          prisma.walletTransaction.create({
            data: {
              userId: matchedTrip.travelerId,
              type: 'DELIVERY_EARNED',
              amount: travelerPayout,
              status: 'COMPLETED',
              description: `Earned from ${parcel.fromLocation} → ${parcel.toLocation} (Online)`,
              parcelId: parcel.id
            }
          })
        );
      } else {
        // CASE 2: CASH (Pick up or Delivery) — Traveler has the full cash, they owe us the platform fee
        operations.push(
          prisma.user.update({
            where: { id: matchedTrip.travelerId },
            data: { walletBalance: { decrement: platformFee } }
          }),
          prisma.walletTransaction.create({
            data: {
              userId: matchedTrip.travelerId,
              type: 'PLATFORM_FEE_DEDUCTION',
              amount: platformFee,
              status: 'COMPLETED',
              description: `Platform fee for ${parcel.fromLocation} → ${parcel.toLocation} (Cash collected)`,
              parcelId: parcel.id
            }
          })
        );
      }
    }

    await prisma.$transaction(operations);

    // Notify the sender
    await createNotification({
      userId: parcel.senderId,
      type: 'PARCEL_DELIVERED',
      title: 'Parcel Delivered! 🎉',
      body: `Great news! Your parcel "${parcel.name || 'Package'}" has been delivered successfully.`,
      metadata: { parcelId: pId }
    });

    // Notify the traveler about earnings
    if (matchedTrip) {
      if (isOnline && travelerPayout > 0) {
        await createNotification({
          userId: matchedTrip.travelerId,
          type: 'PAYMENT_RECEIVED',
          title: 'Payment Credited 💰',
          body: `You earned LKR ${travelerPayout} for delivering the parcel from ${parcel.fromLocation}.`,
          metadata: { parcelId: pId }
        });
      } else if (!isOnline && travelerPayout > 0) {
        await createNotification({
          userId: matchedTrip.travelerId,
          type: 'PAYMENT_RECEIVED',
          title: 'Cash Collected 💵',
          body: `You earned LKR ${travelerPayout} in cash for delivering the parcel from ${parcel.fromLocation}.`,
          metadata: { parcelId: pId }
        });
      }
    }

    console.log(`✅ Delivery confirmed. Traveler ${matchedTrip?.travelerId} credited LKR ${parcel.travelerPayout}`);

    res.status(200).json({ message: 'Parcel delivered! Transaction complete.' });
  } catch (error) {
    res.status(500).json({ message: 'Error verifying delivery' });
  }
};

/**
 * CANCEL MATCH: Sender withdraws their PENDING request anytime before traveler accepts
 * PATCH /api/delivery/match/:id/cancel
 */
export const cancelMatch = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user.id as string;

    const match = await prisma.match.findUnique({
      where: { id },
      include: { parcel: true }
    });

    if (!match) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Only the SENDER can cancel
    if (match.senderId !== userId) {
      return res.status(403).json({ message: 'Only the sender can cancel this request' });
    }

    // Can only cancel if still PENDING (not yet accepted)
    if (match.status !== 'PENDING') {
      return res.status(400).json({ message: 'Cannot cancel — request has already been accepted or closed' });
    }

    await prisma.match.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    // 🔌 Emit real-time socket event → traveler's modal auto-closes instantly
    try {
      io.to(match.travelerId).emit('request_cancelled', { matchId: id });
      console.log(`Socket: request_cancelled emitted to traveler ${match.travelerId} for match ${id}`);
    } catch (socketError) {
      console.error('Socket emit failed (non-critical):', socketError);
    }

    // Push notification as fallback (for background/offline traveler)
    await createNotification({
      userId: match.travelerId,
      type: 'MATCH_CANCELLED',
      title: 'Delivery Request Withdrawn',
      body: `The sender has withdrawn the delivery request for "${match.parcel?.name || 'a parcel'}".`,
      metadata: { matchId: id }
    });

    res.status(200).json({ message: 'Request cancelled successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error cancelling request' });
  }
};
