import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { calculateParcelPrice } from '../utils/priceCalculator';

const prisma = new PrismaClient();

// --- ROUTE MANAGEMENT (ADMIN) ---

export const createRoute = async (req: Request, res: Response) => {
  try {
    const { fromLocation, toLocation, distanceKm, rate } = req.body;
    
    // Create bidirectional routes optionally or just single one? 
    // User mentioned "predefined routes", usually they come in pairs.
    // For now, let's just create the one requested.
    
    const route = await prisma.route.create({
      data: {
        fromLocation,
        toLocation,
        distanceKm: parseFloat(distanceKm),
        rate: parseFloat(rate)
      }
    });

    res.status(201).json(route);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'Route already exists' });
    }
    res.status(500).json({ message: 'Error creating route' });
  }
};

export const getRoutes = async (req: Request, res: Response) => {
  try {
    const routes = await prisma.route.findMany({
      orderBy: { fromLocation: 'asc' }
    });
    res.status(200).json(routes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching routes' });
  }
};

export const updateRoute = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { rate, distanceKm, isActive } = req.body;

    const route = await prisma.route.update({
      where: { id },
      data: {
        rate: rate ? parseFloat(rate) : undefined,
        distanceKm: distanceKm ? parseFloat(distanceKm) : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    res.status(200).json(route);
  } catch (error) {
    res.status(500).json({ message: 'Error updating route' });
  }
};

export const deleteRoute = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.route.delete({ where: { id } });
    res.status(200).json({ message: 'Route deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting route' });
  }
};

// --- WEIGHT SLAB MANAGEMENT (ADMIN) ---

export const createWeightSlab = async (req: Request, res: Response) => {
  try {
    const { minWeight, maxWeight, surcharge, label } = req.body;
    
    const slab = await prisma.weightSlab.create({
      data: {
        minWeight: parseFloat(minWeight),
        maxWeight: parseFloat(maxWeight),
        surcharge: parseFloat(surcharge),
        label
      }
    });

    res.status(201).json(slab);
  } catch (error) {
    res.status(500).json({ message: 'Error creating weight slab' });
  }
};

export const getWeightSlabs = async (req: Request, res: Response) => {
  try {
    const slabs = await prisma.weightSlab.findMany({
      orderBy: { minWeight: 'asc' }
    });
    res.status(200).json(slabs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching weight slabs' });
  }
};

export const updateWeightSlab = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { minWeight, maxWeight, surcharge, label, isActive } = req.body;

    const slab = await prisma.weightSlab.update({
      where: { id },
      data: {
        minWeight: minWeight !== undefined ? parseFloat(minWeight) : undefined,
        maxWeight: maxWeight !== undefined ? parseFloat(maxWeight) : undefined,
        surcharge: surcharge !== undefined ? parseFloat(surcharge) : undefined,
        label: label !== undefined ? label : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    res.status(200).json(slab);
  } catch (error) {
    res.status(500).json({ message: 'Error updating weight slab' });
  }
};

export const deleteWeightSlab = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.weightSlab.delete({ where: { id } });
    res.status(200).json({ message: 'Weight slab deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting weight slab' });
  }
};

// --- PARCEL CATEGORY MANAGEMENT (ADMIN) ---

export const createParcelCategory = async (req: Request, res: Response) => {
  try {
    const { name, pricingType, description } = req.body;

    const category = await prisma.parcelCategory.create({
      data: { name, pricingType, description }
    });

    res.status(201).json(category);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'A category with this name already exists' });
    }
    res.status(500).json({ message: 'Error creating parcel category' });
  }
};

export const getParcelCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.parcelCategory.findMany({
      orderBy: { createdAt: 'asc' }
    });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching parcel categories' });
  }
};

export const updateParcelCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { name, pricingType, description, isActive } = req.body;

    const category = await prisma.parcelCategory.update({
      where: { id },
      data: {
        name: name !== undefined ? name : undefined,
        pricingType: pricingType !== undefined ? pricingType : undefined,
        description: description !== undefined ? description : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    res.status(200).json(category);
  } catch (error) {
    res.status(500).json({ message: 'Error updating parcel category' });
  }
};

export const deleteParcelCategory = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.parcelCategory.delete({ where: { id } });
    res.status(200).json({ message: 'Parcel category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting parcel category' });
  }
};

// --- CATEGORY FARE MANAGEMENT (ADMIN) ---

export const createCategoryFare = async (req: Request, res: Response) => {
  try {
    const { categoryId, routeId, fare } = req.body;

    const categoryFare = await prisma.categoryFare.create({
      data: {
        categoryId,
        routeId,
        fare: parseFloat(fare)
      }
    });

    res.status(201).json(categoryFare);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ message: 'A fare for this category and route already exists' });
    }
    res.status(500).json({ message: 'Error creating category fare' });
  }
};

export const getCategoryFares = async (req: Request, res: Response) => {
  try {
    const { categoryId } = req.query;

    const fares = await prisma.categoryFare.findMany({
      where: categoryId ? { categoryId: categoryId as string } : undefined,
      include: { category: true, route: true },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json(fares);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching category fares' });
  }
};

export const updateCategoryFare = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { fare, isActive } = req.body;

    const categoryFare = await prisma.categoryFare.update({
      where: { id },
      data: {
        fare: fare !== undefined ? parseFloat(fare) : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });

    res.status(200).json(categoryFare);
  } catch (error) {
    res.status(500).json({ message: 'Error updating category fare' });
  }
};

export const deleteCategoryFare = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.categoryFare.delete({ where: { id } });
    res.status(200).json({ message: 'Category fare deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting category fare' });
  }
};

// --- ACTIVE CATEGORIES (CUSTOMER APP) ---

export const getActiveParcelCategories = async (req: Request, res: Response) => {
  try {
    const categories = await prisma.parcelCategory.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching parcel categories' });
  }
};

// --- PLATFORM CONFIG ---

export const updateConfig = async (req: Request, res: Response) => {
  try {
    const { key, value, description } = req.body;
    
    const config = await prisma.platformConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description }
    });

    res.status(200).json(config);
  } catch (error) {
    res.status(500).json({ message: 'Error updating config' });
  }
};

export const getConfig = async (req: Request, res: Response) => {
  try {
    const configs = await prisma.platformConfig.findMany();
    res.status(200).json(configs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching config' });
  }
};

export const deleteConfig = async (req: Request, res: Response) => {
  try {
    const key = req.params.key as string;
    await prisma.platformConfig.delete({ where: { key } });
    res.status(200).json({ message: 'Config deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting config' });
  }
};

// --- PREVIEW FOR CUSTOMERS ---

export const getPricePreview = async (req: Request, res: Response) => {
  try {
    const { fromLocation, toLocation, categoryId, weight } = req.query;

    if (!fromLocation || !toLocation || !categoryId) {
      return res.status(400).json({ message: 'Missing parameters' });
    }

    const pricing = await calculateParcelPrice(
      fromLocation as string,
      toLocation as string,
      categoryId as string,
      weight !== undefined ? parseFloat(weight as string) : undefined
    );

    res.status(200).json(pricing);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

// --- LOCATION SELECTION ---

export const getFromLocations = async (req: Request, res: Response) => {
  try {
    const locations = await prisma.route.findMany({
      where: { isActive: true },
      select: { fromLocation: true },
      distinct: ['fromLocation'],
      orderBy: { fromLocation: 'asc' }
    });
    
    // Return flat array of strings
    res.status(200).json(locations.map(l => l.fromLocation));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching from locations' });
  }
};

export const getToLocations = async (req: Request, res: Response) => {
  try {
    const { fromLocation } = req.query;
    
    const where: any = { isActive: true };
    if (fromLocation) {
      where.fromLocation = fromLocation as string;
    }

    const locations = await prisma.route.findMany({
      where,
      select: { toLocation: true },
      distinct: ['toLocation'],
      orderBy: { toLocation: 'asc' }
    });
    
    // Return flat array of strings
    res.status(200).json(locations.map(l => l.toLocation));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching to locations' });
  }
};
