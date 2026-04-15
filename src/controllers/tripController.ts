import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

export const createTrip = async (req: AuthRequest, res: Response) => {
  try {
    const { fromLocation, toLocation, travelDate, capacityKg } = req.body;

    // Only approved TRAVELERs can create trips
    if (req.user.role !== 'TRAVELER') {
      return res.status(403).json({ message: 'Only travelers can create trips' });
    }

    const trip = await prisma.trip.create({
      data: {
        travelerId: req.user.id,
        fromLocation,
        toLocation,
        travelDate: new Date(travelDate),
        capacityKg: parseFloat(capacityKg),
        status: 'ACTIVE'
      }
    });

    res.status(201).json(trip);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating trip' });
  }
};

export const getMyTrips = async (req: AuthRequest, res: Response) => {
  try {
    const trips = await prisma.trip.findMany({
      where: { travelerId: req.user.id },
      include: { parcels: true }
    });
    res.status(200).json(trips);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching trips' });
  }
};

export const getAllActiveTrips = async (req: Request, res: Response) => {
  try {
    const trips = await prisma.trip.findMany({
      where: { status: 'ACTIVE' },
      include: { traveler: { select: { name: true, phone: true, rating: true } } }
    });
    res.status(200).json(trips);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching trips' });
  }
};
