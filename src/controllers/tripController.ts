import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

export const createTrip = async (req: AuthRequest, res: Response) => {
  try {
    const { fromLocation, toLocation, travelDate, capacityKg, travelTime, note, exactLocation, vehicleType } = req.body;

    // Only approved TRAVELERs can create trips
    if (req.user.roleActive !== 'TRAVELER') {
      return res.status(403).json({ message: 'Only travelers can create trips' });
    }

    const trip = await prisma.trip.create({
      data: {
        travelerId: req.user.id,
        fromLocation,
        toLocation,
        travelDate: new Date(travelDate),
        capacityKg: parseFloat(capacityKg),
        travelTime: travelTime || null,
        note: note || null,
        exactLocation: exactLocation || null,
        vehicleType: vehicleType || null,
        status: 'ACTIVE'
      }
    });

    res.status(201).json(trip);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating trip' });
  }
};

export const cancelTrip = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const travelerId = req.user.id;

    const trip = await prisma.trip.findUnique({
      where: { id: id },
      include: { parcels: true }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    if (trip.travelerId !== travelerId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Check if any parcels are assigned (customer assigned)
    if (trip.parcels.length > 0 || trip.usedCapacity > 0) {
      return res.status(400).json({ message: 'Cannot cancel trip: Customers are already assigned' });
    }

    const updatedTrip = await prisma.trip.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    res.status(200).json({ message: 'Trip cancelled', trip: updatedTrip });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error cancelling trip' });
  }
};

export const deleteTrip = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const travelerId = req.user.id;

    const trip = await prisma.trip.findUnique({
      where: { id: id }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    if (trip.travelerId !== travelerId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (trip.status !== 'CANCELLED') {
      return res.status(400).json({ message: 'Only cancelled trips can be deleted' });
    }

    await prisma.trip.delete({
      where: { id }
    });

    res.status(200).json({ message: 'Trip deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error deleting trip' });
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
      where: { 
        status: 'ACTIVE',
        travelerId: { not: (req as any).user.id } // Don't show your own trips
      },
      include: { 
        traveler: { select: { id: true, name: true, rating: true, selfieUrl: true } },
        matches: {
          where: { senderId: (req as any).user.id, status: 'PENDING' },
          select: { id: true }
        }
      }
    });

    const tripsWithStatus = trips.map(t => ({
      ...t,
      isRequested: t.matches.length > 0,
      matches: undefined // Clean up response
    }));

    res.status(200).json(tripsWithStatus);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching active trips' });
  }
};

export const getTripById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const trip = await prisma.trip.findUnique({
      where: { id },
      include: {
        traveler: {
          select: {
            id: true,
            name: true,
            phone: true,
            rating: true,
            trustScore: true
          }
        },
        parcels: {
          include: {
            sender: { select: { name: true } }
          }
        }
      }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    // Check if the current user (Customer) has already requested this traveler/trip
    const existingMatch = await prisma.match.findFirst({
      where: {
        tripId: id,
        senderId: (req as any).user.id,
        status: { in: ['PENDING', 'ACCEPTED'] }
      }
    });

    res.status(200).json({ ...trip, userMatch: existingMatch });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching trip details' });
  }
};
