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
  categoryId: string,
  weight?: number
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

  // 2. Find the Category
  const category = await prisma.parcelCategory.findUnique({
    where: { id: categoryId },
  });

  if (!category || !category.isActive) {
    throw new Error('Invalid or inactive parcel category');
  }

  // 3. Calculate subtotal based on the category's pricing type
  let subtotal: number;

  if (category.pricingType === 'FIXED_FARE') {
    const categoryFare = await prisma.categoryFare.findFirst({
      where: { categoryId: category.id, routeId: route.id, isActive: true },
    });

    if (!categoryFare) {
      throw new Error(`No fixed fare configured for ${category.name} on this route`);
    }

    subtotal = categoryFare.fare;
  } else {
    if (weight === undefined || weight === null || isNaN(weight)) {
      throw new Error('Weight is required for this parcel category');
    }

    const slab = await prisma.weightSlab.findFirst({
      where: {
        minWeight: { lte: weight },
        maxWeight: { gt: weight },
        isActive: true,
      },
    });

    const weightSurcharge = slab ? slab.surcharge : 0;
    subtotal = route.rate + weightSurcharge;
  }

  // 4. Get Platform Fee Percentage
  const config = await prisma.platformConfig.findUnique({
    where: { key: 'platformFeePercent' },
  });

  const platformFeePercent = config ? parseFloat(config.value) : 15; // Default to 15%

  // 5. Calculate final values
  const platformFee = subtotal * (platformFeePercent / 100);
  const travelerPayout = subtotal - platformFee;

  return {
    price: subtotal,
    platformFee,
    travelerPayout,
    routeId: route.id,
  };
};
