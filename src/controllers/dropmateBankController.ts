import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Public: GET /api/dropmate-bank-details
export const getDropMateBankDetails = async (req: Request, res: Response) => {
  try {
    const bankDetails = await prisma.dropMateBankDetail.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    return res.status(200).json(bankDetails);
  } catch (error) {
    console.error('getDropMateBankDetails error:', error);
    return res.status(500).json({ message: 'Error fetching DropMate bank details' });
  }
};

// Admin: GET /api/admin/dropmate-bank-details
export const getDropMateBankDetailsAdmin = async (req: Request, res: Response) => {
  try {
    const bankDetails = await prisma.dropMateBankDetail.findMany({
      orderBy: { createdAt: 'asc' }
    });
    return res.status(200).json(bankDetails);
  } catch (error) {
    console.error('getDropMateBankDetailsAdmin error:', error);
    return res.status(500).json({ message: 'Error fetching DropMate bank details' });
  }
};

// Admin: POST /api/admin/dropmate-bank-details
export const createDropMateBankDetail = async (req: Request, res: Response) => {
  try {
    const { bankName, accountName, accountNumber, branchName } = req.body;

    if (!bankName || !accountName || !accountNumber || !branchName) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const newDetail = await prisma.dropMateBankDetail.create({
      data: { bankName, accountName, accountNumber, branchName }
    });

    return res.status(201).json(newDetail);
  } catch (error) {
    console.error('createDropMateBankDetail error:', error);
    return res.status(500).json({ message: 'Error creating DropMate bank detail' });
  }
};

// Admin: PUT /api/admin/dropmate-bank-details/:id
export const updateDropMateBankDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { bankName, accountName, accountNumber, branchName, isActive } = req.body;

    const updatedDetail = await prisma.dropMateBankDetail.update({
      where: { id },
      data: { bankName, accountName, accountNumber, branchName, isActive }
    });

    return res.status(200).json(updatedDetail);
  } catch (error) {
    console.error('updateDropMateBankDetail error:', error);
    return res.status(500).json({ message: 'Error updating DropMate bank detail' });
  }
};

// Admin: DELETE /api/admin/dropmate-bank-details/:id
export const deleteDropMateBankDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.dropMateBankDetail.delete({ where: { id } });
    return res.status(200).json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('deleteDropMateBankDetail error:', error);
    return res.status(500).json({ message: 'Error deleting DropMate bank detail' });
  }
};
