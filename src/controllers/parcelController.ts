import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

import { calculateParcelPrice } from '../utils/priceCalculator';
import { createNotification } from './notificationController';
import { notifyAdmins } from '../utils/notificationHelpers';


const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

export const createParcel = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      name, fromLocation, toLocation, weight, description, 
      receiverName, receiverPhone, deliveryMethod, deliveryAddress, note,
      paymentMethod
    } = req.body;

    // --- HANDLE MULTIPLE IMAGES ---
    const imageUrls: string[] = [];
    if (req.files && Array.isArray(req.files)) {
      (req.files as any[]).forEach(file => {
        if (file.path) imageUrls.push(file.path);
      });
    }

    // --- AUTO CALCULATE PRICE ---
    const parcelWeight = parseFloat(weight);
    const pricing = await calculateParcelPrice(fromLocation, toLocation, parcelWeight);

    const parcel = await prisma.parcel.create({
      data: {
        senderId: req.user.id,
        name,
        fromLocation,
        toLocation,
        weight: parcelWeight,
        description,
        imageUrls, // Save the array of images
        receiverName,
        receiverPhone,
        deliveryMethod,
        deliveryAddress,
        note,
        status: 'PENDING',
        paymentMethod: paymentMethod || 'CASH_ON_DELIVERY',
        
        // Save pricing details
        price: pricing.price,
        platformFee: pricing.platformFee,
        travelerPayout: pricing.travelerPayout,
        routeId: pricing.routeId
      }
    });
    
    // Notify the customer
    await createNotification({
      userId: req.user.id,
      type: 'PARCEL_CREATED',
      title: 'Parcel Created!',
      body: `Your parcel "${name}" has been listed. You can now match it with travelers.`,
      metadata: { parcelId: parcel.id }
    });

    // Notify Admins
    await notifyAdmins({
      type: 'PARCEL_CREATED',
      title: 'New Parcel Listed',
      body: `A new parcel "${name}" has been listed from ${fromLocation} to ${toLocation}.`,
      metadata: { parcelId: parcel.id, senderId: req.user.id }
    });


    res.status(201).json(parcel);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating parcel' });
  }
};

export const getMyParcels = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [parcels, total] = await Promise.all([
      prisma.parcel.findMany({
        where: { senderId: userId },
        include: {
          matches: {
            where: { status: 'PENDING' },
            select: { id: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.parcel.count({ where: { senderId: userId } }),
    ]);

    const parcelsWithStatus = parcels.map(p => ({
      ...p,
      isRequested: p.matches.length > 0,
      matches: undefined,
    }));

    res.status(200).json({
      parcels: parcelsWithStatus,
      total,
      page,
      limit,
      hasMore: skip + parcels.length < total,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching your parcels' });
  }
};

export const cancelParcel = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const parcel = await prisma.parcel.findUnique({ where: { id } });

    if (!parcel || parcel.senderId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (parcel.status !== 'PENDING') {
      return res.status(400).json({ message: 'Cannot cancel parcel that is already matched or shipped' });
    }

    await prisma.parcel.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    res.status(200).json({ message: 'Parcel cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error cancelling parcel' });
  }
};

export const deleteParcel = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const parcel = await prisma.parcel.findUnique({
      where: { id },
      include: {
        matches: {
          where: { status: { in: ['PENDING', 'ACCEPTED'] } },
          select: { id: true }
        }
      }
    });

    if (!parcel || parcel.senderId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Allow deletion if:
    // 1. Parcel is CANCELLED, OR
    // 2. Parcel is PENDING with no active/accepted matches 
    const hasActiveMatch = parcel.matches.length > 0;
    const isDeletable = parcel.status === 'CANCELLED' || (parcel.status === 'PENDING' && !hasActiveMatch);

    if (!isDeletable) {
      return res.status(400).json({ 
        message: 'Cannot delete this parcel. It may have an active delivery request or is already in transit.' 
      });
    }

    // Delete associated rejected matches first to avoid FK constraint errors
    await prisma.match.deleteMany({ where: { parcelId: id } });
    await prisma.parcel.delete({ where: { id } });

    res.status(200).json({ message: 'Parcel deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error deleting parcel' });
  }
};

export const getParcelById = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const parcel = await prisma.parcel.findUnique({
      where: { id: id },
      include: {
        sender: { select: { id: true, name: true, phone: true, travelerRating: true, customerRating: true, selfieUrl: true } },
        matches: {
          include: {
            traveler: { select: { id: true, name: true, phone: true, travelerRating: true, customerRating: true, selfieUrl: true } },
            sender: { select: { id: true, name: true, travelerRating: true, customerRating: true, selfieUrl: true } },
            trip: true
          }
        },
        matchedTrip: {
          include: {
            traveler: { select: { id: true, name: true, phone: true, travelerRating: true, customerRating: true, selfieUrl: true } }
          }
        },
        reviews: true
      }
    });

    if (!parcel) {
      return res.status(404).json({ message: 'Parcel not found' });
    }

    // Check if the current user has a pending or accepted delivery request for this parcel
    const existingMatch = await prisma.match.findFirst({
      where: {
        parcelId: id,
        travelerId: req.user.id,
        status: { in: ['PENDING', 'ACCEPTED'] }
      }
    });

    const parcelWithMatch = { ...parcel, userMatch: existingMatch };
    
    // ✅ NEW PRIVACY RULES:
    // Sender and Admin always see everything.
    // Traveler ONLY sees sensitive info if the Parcel is status 'MATCHED' or later AND they are the assigned traveler.
    const isSender = parcel.senderId === req.user.id;
    const isMatchedTraveler = ['MATCHED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(parcel.status) && parcel.matchedTrip?.travelerId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';
    const isPending = parcel.status === 'PENDING';

    if (!isSender && !isMatchedTraveler && !isAdmin && !isPending) {
      return res.status(403).json({ message: 'Unauthorized to view this parcel' });
    }

    // Strip sensitive information if the user is not the sender, admin, or THE accepted matched traveler
    if (!isSender && !isAdmin && !isMatchedTraveler) {
      const { receiverName, receiverPhone, deliveryAddress, ...publicData } = parcelWithMatch;
      
      // Also strip sender phone from the included sender object
      if (publicData.sender) {
        (publicData.sender as any).phone = undefined;
      }

      return res.status(200).json(publicData);
    }

    res.status(200).json(parcelWithMatch);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching parcel details' });
  }
};

export const getAllActiveParcels = async (req: Request, res: Response) => {
  try {
    const parcels = await prisma.parcel.findMany({
      where: { status: 'PENDING' },
      include: { 
        sender: { select: { id: true, name: true, travelerRating: true, customerRating: true } },
        matches: {
          where: { travelerId: (req as any).user.id, status: 'PENDING' },
          select: { id: true }
        }
      }
    });

    const parcelsWithStatus = parcels.map(p => ({
      ...p,
      isRequested: p.matches.length > 0,
      matches: undefined // Clean up the response
    }));

    res.status(200).json(parcelsWithStatus);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching active parcels' });
  }
};

export const payParcel = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const parcel = await prisma.parcel.findUnique({ where: { id } });

    if (!parcel) {
      return res.status(404).json({ message: 'Parcel not found' });
    }

    if (parcel.senderId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (parcel.paymentMethod !== 'ONLINE') {
      return res.status(400).json({ message: 'Only online payments can be processed this way' });
    }

    if (parcel.paymentStatus === 'PAID') {
      return res.status(400).json({ message: 'Parcel is already paid' });
    }

    await prisma.parcel.update({
      where: { id },
      data: { paymentStatus: 'PAID' }
    });

    res.status(200).json({ message: 'Payment successful' });
  } catch (error) {
    res.status(500).json({ message: 'Error processing payment' });
  }
};
