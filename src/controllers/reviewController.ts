import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

/**
 * Create a review for a parcel transaction (2-way rating)
 * POST /api/reviews
 */
export const createReview = async (req: AuthRequest, res: Response) => {
  try {
    const rating = req.body.rating as number;
    const comment = req.body.comment as string;
    const parcelId = req.body.parcelId as string;
    const revieweeId = req.body.revieweeId as string;
    const reviewerId = req.user.id as string;

    if (!rating || !parcelId || !revieweeId) {
      return res.status(400).json({ message: 'Rating, parcelId, and revieweeId are required' });
    }

    // Check if parcel exists and is delivered
    const parcel = await prisma.parcel.findUnique({
      where: { id: parcelId },
      include: { matchedTrip: true }
    });

    if (!parcel) return res.status(404).json({ message: 'Parcel not found' });
    if (parcel.status !== 'DELIVERED') {
      return res.status(400).json({ message: 'Ratings can only be given after the parcel is delivered' });
    }

    // Verify if the reviewer is either the sender or the traveler
    const isSender = parcel.senderId === reviewerId;
    const isTraveler = parcel.matchedTrip?.travelerId === reviewerId;

    if (!isSender && !isTraveler) {
      return res.status(403).json({ message: 'Unauthorized: You are not part of this transaction' });
    }

    // Verify if the reviewee is indeed the other party
    const targetRevieweeId = isSender ? parcel.matchedTrip?.travelerId : parcel.senderId;
    if (revieweeId !== targetRevieweeId) {
      return res.status(400).json({ message: 'Invalid reviewee: You can only rate the person you transacted with' });
    }

    // Create the review
    const revieweeRole = isSender ? 'TRAVELER' : 'CUSTOMER';

    const review = await prisma.review.create({
      data: {
        rating: Math.min(5, Math.max(1, rating)), // Clamp between 1-5
        comment,
        parcelId,
        reviewerId,
        revieweeId,
        revieweeRole
      }
    });

    // Recalculate average rating for the reviewee based on the role
    const aggregations = await prisma.review.aggregate({
      where: { 
        revieweeId,
        revieweeRole
      },
      _avg: { rating: true },
    });

    const newAvgRaw = aggregations._avg.rating || 0;
    const newAvg = Math.round(newAvgRaw * 10) / 10;

    await prisma.user.update({
      where: { id: revieweeId },
      data: {
        [revieweeRole === 'TRAVELER' ? 'travelerRating' : 'customerRating']: newAvg
      }
    });

    res.status(201).json({
      message: 'Thank you for your feedback!',
      review
    });

  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'You have already rated this transaction' });
    }
    console.error('Create review error:', error);
    res.status(500).json({ message: 'Failed to submit review' });
  }
};

/**
 * Get all reviews received by a specific user
 * GET /api/reviews/user/:userId
 */
export const getUserReviews = async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const reviews = await prisma.review.findMany({
      where: { revieweeId: userId },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            selfieUrl: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json(reviews);
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ message: 'Failed to fetch reviews' });
  }
};
