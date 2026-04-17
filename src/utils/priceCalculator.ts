import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface PricingResult {
  price: number;
  platformFee: number;
  travelerPayout: number;
  routeId: string;
}

export const calculateParcelPrice = async (
  fromLocation: string,
  toLocation: string,
  weight: number
): Promise<PricingResult> => {
  // 1. Find the Route
  const route = await prisma.route.findFirst({
    where: {
      fromLocation: { equals: fromLocation, mode: 'insensitive' },
      toLocation: { equals: toLocation, mode: 'insensitive' },
      isActive: true,
    },
  });

  if (!route) {
    throw new Error(`No active route found from ${fromLocation} to ${toLocation}`);
  }

  // 2. Find the Weight Slab
  const slab = await prisma.weightSlab.findFirst({
    where: {
      minWeight: { lte: weight },
      maxWeight: { gt: weight },
      isActive: true,
    },
  });

  const weightSurcharge = slab ? slab.surcharge : 0;

  // 3. Get Platform Fee Percentage
  const config = await prisma.platformConfig.findUnique({
    where: { key: 'platformFeePercent' },
  });

  const platformFeePercent = config ? parseFloat(config.value) : 15; // Default to 15%

  // 4. Calculate final values
  const subtotal = route.rate + weightSurcharge;
  const platformFee = subtotal * (platformFeePercent / 100);
  const travelerPayout = subtotal - platformFee;

  return {
    price: subtotal,
    platformFee,
    travelerPayout,
    routeId: route.id,
  };
};
