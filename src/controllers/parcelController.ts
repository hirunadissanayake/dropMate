import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

import { calculateParcelPrice } from '../utils/priceCalculator';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

export const createParcel = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      fromLocation, toLocation, weight, description, 
      receiverName, receiverPhone, deliveryMethod, deliveryAddress, note 
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
        
        // Save pricing details
        price: pricing.price,
        platformFee: pricing.platformFee,
        travelerPayout: pricing.travelerPayout,
        routeId: pricing.routeId
      }
    });

    res.status(201).json(parcel);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating parcel' });
  }
};

export const getMyParcels = async (req: AuthRequest, res: Response) => {
  try {
    const parcels = await prisma.parcel.findMany({
      where: { senderId: req.user.id },
      include: { matchedTrip: true }
    });
    res.status(200).json(parcels);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching parcels' });
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
    const parcel = await prisma.parcel.findUnique({ where: { id } });

    if (!parcel || parcel.senderId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (parcel.status !== 'CANCELLED') {
      return res.status(400).json({ message: 'Only cancelled parcels can be deleted' });
    }

    await prisma.parcel.delete({ where: { id } });

    res.status(200).json({ message: 'Parcel deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting parcel' });
  }
};
