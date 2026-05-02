import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const createBanner = async (req: Request, res: Response) => {
  try {
    const { title, description, link, screen } = req.body;
    const imageUrl = req.file?.path;

    if (!imageUrl) {
      return res.status(400).json({ message: 'Banner image is required' });
    }

    const banner = await prisma.banner.create({
      data: {
        imageUrl,
        title,
        description,
        link,
        screen: screen || 'BOTH',
      },
    });

    res.status(201).json(banner);
  } catch (error: any) {
    res.status(500).json({ message: 'Error creating banner', error: error.message });
  }
};

export const getBanners = async (req: Request, res: Response) => {
  try {
    const { screen } = req.query;
    const where: any = { isActive: true };
    
    if (screen && screen !== 'BOTH') {
      where.OR = [
        { screen: screen },
        { screen: 'BOTH' }
      ];
    }

    const banners = await prisma.banner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(banners);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching banners', error: error.message });
  }
};

export const getAllBannersAdmin = async (req: Request, res: Response) => {
  try {
    const banners = await prisma.banner.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(banners);
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching banners', error: error.message });
  }
};

export const updateBanner = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { title, description, link, screen, isActive } = req.body;
    const imageUrl = req.file?.path;

    const updateData: any = {
      title,
      description,
      link,
      screen,
      isActive: isActive === 'true' || isActive === true,
    };

    if (imageUrl) {
      updateData.imageUrl = imageUrl;
    }

    const banner = await prisma.banner.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json(banner);
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating banner', error: error.message });
  }
};

export const deleteBanner = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.banner.delete({ where: { id } });
    res.status(200).json({ message: 'Banner deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error deleting banner', error: error.message });
  }
};
