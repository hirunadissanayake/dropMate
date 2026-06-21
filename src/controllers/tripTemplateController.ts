import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
  body: any;
  params: any;
}

export const createTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      templateName, 
      fromLocation, 
      toLocation, 
      capacityKg, 
      travelTime, 
      note, 
      exactLocation, 
      vehicleType, 
      pickupUrl, 
      dropoffUrl 
    } = req.body;

    if (req.user.roleActive !== 'TRAVELER') {
      return res.status(403).json({ message: 'Only travelers can create templates' });
    }

    const template = await prisma.tripTemplate.create({
      data: {
        travelerId: req.user.id,
        templateName,
        fromLocation,
        toLocation,
        capacityKg: parseFloat(capacityKg),
        travelTime: travelTime || null,
        note: note || null,
        exactLocation: exactLocation || null,
        vehicleType: vehicleType || null,
        pickupUrl: pickupUrl || null,
        dropoffUrl: dropoffUrl || null,
      }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ message: 'Error creating template' });
  }
};

export const getMyTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const templates = await prisma.tripTemplate.findMany({
      where: { travelerId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Error fetching templates' });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const template = await prisma.tripTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    if (template.travelerId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    await prisma.tripTemplate.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ message: 'Error deleting template' });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      templateName, 
      fromLocation, 
      toLocation, 
      capacityKg, 
      travelTime, 
      note, 
      exactLocation, 
      vehicleType, 
      pickupUrl, 
      dropoffUrl 
    } = req.body;

    const template = await prisma.tripTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }

    if (template.travelerId !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const updatedTemplate = await prisma.tripTemplate.update({
      where: { id },
      data: {
        templateName,
        fromLocation,
        toLocation,
        capacityKg: capacityKg ? parseFloat(capacityKg) : undefined,
        travelTime: travelTime || null,
        note: note || null,
        exactLocation: exactLocation || null,
        vehicleType: vehicleType || null,
        pickupUrl: pickupUrl || null,
        dropoffUrl: dropoffUrl || null,
      },
    });

    res.status(200).json(updatedTemplate);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ message: 'Error updating template' });
  }
};

