import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { notifyAdmins } from '../utils/notificationHelpers';

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

    // ✅ Notify Admin about new trip
    await notifyAdmins({
      type: 'GENERAL',
      title: 'New Trip Created',
      body: `A traveler has created a new trip from ${fromLocation} to ${toLocation} for ${new Date(travelDate).toLocaleDateString()}.`,
      metadata: { tripId: trip.id, travelerId: req.user.id }
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
      where: { id: id },
      include: { parcels: true }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    if (trip.travelerId !== travelerId) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // A trip can be deleted if it is CANCELLED OR if it is expired with 0 parcels
    const isExpired = checkTripExpired(trip.travelDate, trip.travelTime);
    const noParcels = !trip.parcels || trip.parcels.length === 0;

    if (trip.status !== 'CANCELLED' && !(isExpired && noParcels)) {
      return res.status(400).json({ message: 'Only cancelled trips or expired trips with no parcels can be deleted' });
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

    // Get current time in Sri Lanka timezone
    const nowStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Colombo"});
    const slNow = new Date(nowStr);
    
    const startOfToday = new Date(slNow);
    startOfToday.setHours(0, 0, 0, 0);
    const currentHours = slNow.getHours();
    const currentMinutes = slNow.getMinutes();

    const tripsWithExpiry = trips.map(t => {
      let isExpired = false;
      const tripDate = new Date(t.travelDate); // Assumes travelDate is correctly stored (or only cares about the date part)
      // Normalize tripDate to local start of day for comparison
      const localTripDate = new Date(tripDate.toLocaleString("en-US", {timeZone: "Asia/Colombo"}));
      localTripDate.setHours(0, 0, 0, 0);

      // Check if the trip is in the past
      if (localTripDate < startOfToday) {
        isExpired = true;
      } else if (localTripDate.getTime() === startOfToday.getTime() && t.travelTime) {
        // If it's today, check the time
        const timeMatch = t.travelTime.match(/(\d+)[.:](\d+)\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const period = timeMatch[3].toUpperCase();

          if (period === 'PM' && hours < 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;

          if (hours < currentHours || (hours === currentHours && minutes <= currentMinutes)) {
            isExpired = true;
          }
        }
      }

      // Compute isHistory based on user rules
      const noParcels = !t.parcels || t.parcels.length === 0;
      const allParcelsDelivered = t.parcels && t.parcels.length > 0 && t.parcels.every((p: any) => p.status === 'DELIVERED');
      
      let isHistory = false;
      if (t.status === 'CANCELLED' || t.status === 'COMPLETED') {
        isHistory = true;
      } else if (isExpired && (noParcels || allParcelsDelivered)) {
        isHistory = true;
      }

      return {
        ...t,
        isExpired,
        isHistory
      };
    });

    res.status(200).json(tripsWithExpiry);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching trips' });
  }
};

export const getAllActiveTrips = async (req: Request, res: Response) => {
  try {
    const nowStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Colombo"});
    const slNow = new Date(nowStr);

    const startOfToday = new Date(slNow);
    startOfToday.setHours(0, 0, 0, 0);

    const trips = await prisma.trip.findMany({
      where: { 
        status: 'ACTIVE',
        travelerId: { not: (req as any).user.id },
      },
      include: { 
        traveler: { select: { id: true, name: true, rating: true, selfieUrl: true } },
        parcels: { select: { weight: true } },
        matches: {
          where: { senderId: (req as any).user.id, status: 'PENDING' },
          select: { id: true }
        }
      }
    });

    const tripsWithStatus = trips.map(t => {
      const usedCapacity = (t as any).parcels?.reduce((sum: number, p: any) => sum + (p.weight || 0), 0) || 0;
      return {
        ...t,
        usedCapacity,
        isFull: usedCapacity >= (t.capacityKg || 0),
        isRequested: t.matches.length > 0,
        matches: undefined,
        parcels: undefined
      };
    });

    // Filter out trips that are full AND trips where the travel time has already passed today
    const currentHours = slNow.getHours();
    const currentMinutes = slNow.getMinutes();

    const availableTrips = tripsWithStatus.filter(t => {
      if (t.isFull) return false;

      const tripDate = new Date(t.travelDate);
      const localTripDate = new Date(tripDate.toLocaleString("en-US", {timeZone: "Asia/Colombo"}));
      localTripDate.setHours(0, 0, 0, 0);

      // Filter out past dates entirely
      if (localTripDate < startOfToday) return false;

      // Check if the trip is today
      if (localTripDate.getTime() === startOfToday.getTime() && t.travelTime) {
        // Try to parse travelTime like "10.00PM" or "10:00 PM"
        const timeMatch = t.travelTime.match(/(\d+)[.:](\d+)\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const period = timeMatch[3].toUpperCase();

          if (period === 'PM' && hours < 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;

          // If the travel time has already passed, exclude it
          if (hours < currentHours || (hours === currentHours && minutes <= currentMinutes)) {
            return false;
          }
        }
      }

      return true;
    });

    res.status(200).json(availableTrips);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching active trips' });
  }
};

// Helper function to check if a trip is expired based on Sri Lanka time
const checkTripExpired = (travelDate: Date, travelTime: string | null) => {
  const nowStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Colombo"});
  const slNow = new Date(nowStr);
  const startOfToday = new Date(slNow);
  startOfToday.setHours(0, 0, 0, 0);
  const currentHours = slNow.getHours();
  const currentMinutes = slNow.getMinutes();

  let isExpired = false;
  const tripDate = new Date(travelDate);
  const localTripDate = new Date(tripDate.toLocaleString("en-US", {timeZone: "Asia/Colombo"}));
  localTripDate.setHours(0, 0, 0, 0);

  if (localTripDate < startOfToday) {
    isExpired = true;
  } else if (localTripDate.getTime() === startOfToday.getTime() && travelTime) {
    const timeMatch = travelTime.match(/(\d+)[.:](\d+)\s*(AM|PM)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const period = timeMatch[3].toUpperCase();

      if (period === 'PM' && hours < 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;

      if (hours < currentHours || (hours === currentHours && minutes <= currentMinutes)) {
        isExpired = true;
      }
    }
  }
  return isExpired;
};

export const updateTripCapacity = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { capacityKg } = req.body;
    const userId = (req as any).user.id;

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: { parcels: { select: { weight: true } } }
    });

    if (!trip) return res.status(404).json({ message: 'Trip not found' });
    if (trip.travelerId !== userId) return res.status(403).json({ message: 'Unauthorized' });

    // ✅ Prevent update if expired
    if (checkTripExpired(trip.travelDate, trip.travelTime)) {
      return res.status(400).json({ message: 'Cannot update capacity of an expired trip' });
    }

    // ✅ Validation Rule: New capacity cannot be less than already accepted parcels
    const usedCapacity = (trip as any).parcels?.reduce((sum: number, p: any) => sum + (p.weight || 0), 0) || 0;
    if (Number(capacityKg) < usedCapacity) {
      return res.status(400).json({ 
        message: `You have already accepted ${usedCapacity}kg of parcels. You cannot reduce your limit below that.` 
      });
    }

    const updatedTrip = await prisma.trip.update({
      where: { id },
      data: { capacityKg: Number(capacityKg) }
    });

    res.status(200).json(updatedTrip);
  } catch (error) {
    res.status(500).json({ message: 'Error updating trip capacity' });
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

    // Get IDs of parcels the current user has already requested for this trip
    const existingMatches = await prisma.match.findMany({
      where: {
        tripId: id,
        senderId: (req as any).user.id,
        status: { in: ['PENDING', 'ACCEPTED'] }
      },
      select: { parcelId: true }
    });

    const requestedParcelIds = existingMatches.map(m => m.parcelId);
    
    // Calculate isExpired
    const isExpired = checkTripExpired(trip.travelDate, trip.travelTime);

    res.status(200).json({ ...trip, requestedParcelIds, isExpired });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching trip details' });
  }
};
