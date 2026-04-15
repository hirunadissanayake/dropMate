import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

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

    const parcel = await prisma.parcel.create({
      data: {
        senderId: req.user.id,
        fromLocation,
        toLocation,
        weight: parseFloat(weight),
        description,
        receiverName,
        receiverPhone,
        deliveryMethod,
        deliveryAddress,
        note,
        status: 'PENDING'
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
