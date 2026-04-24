import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

// GET /api/bank-details
// Returns all saved bank details for the current user
export const getBankDetails = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;

    const bankDetails = await prisma.bankDetail.findMany({
      where: { userId },
      orderBy: { isDefault: 'desc' }
    });

    return res.status(200).json(bankDetails);
  } catch (error) {
    console.error('getBankDetails error:', error);
    return res.status(500).json({ message: 'Error fetching bank details' });
  }
};

// POST /api/bank-details
// Adds a new bank detail
export const addBankDetail = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const { bankName, accountNumber, accountHolderName, branchName, isDefault } = req.body;

    if (!bankName || !accountNumber || !accountHolderName) {
      return res.status(400).json({ message: 'Bank name, account number, and holder name are required' });
    }

    // If this is the first bank detail, make it default
    const count = await prisma.bankDetail.count({ where: { userId } });
    const shouldBeDefault = count === 0 ? true : isDefault || false;

    // If setting as default, unset others
    if (shouldBeDefault) {
      await prisma.bankDetail.updateMany({
        where: { userId },
        data: { isDefault: false }
      });
    }

    const newBankDetail = await prisma.bankDetail.create({
      data: {
        userId,
        bankName,
        accountNumber,
        accountHolderName,
        branchName,
        isDefault: shouldBeDefault
      }
    });

    return res.status(201).json(newBankDetail);
  } catch (error) {
    console.error('addBankDetail error:', error);
    return res.status(500).json({ message: 'Error adding bank detail' });
  }
};

// PUT /api/bank-details/:id
// Updates a bank detail
export const updateBankDetail = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const id = req.params.id as string;
    const { bankName, accountNumber, accountHolderName, branchName, isDefault } = req.body;

    const bankDetail = await prisma.bankDetail.findFirst({
      where: { id, userId }
    });

    if (!bankDetail) {
      return res.status(404).json({ message: 'Bank detail not found' });
    }

    // If setting as default, unset others
    if (isDefault && !bankDetail.isDefault) {
      await prisma.bankDetail.updateMany({
        where: { userId },
        data: { isDefault: false }
      });
    }

    const updatedBankDetail = await prisma.bankDetail.update({
      where: { id },
      data: {
        bankName,
        accountNumber,
        accountHolderName,
        branchName,
        isDefault
      }
    });

    return res.status(200).json(updatedBankDetail);
  } catch (error) {
    console.error('updateBankDetail error:', error);
    return res.status(500).json({ message: 'Error updating bank detail' });
  }
};

// DELETE /api/bank-details/:id
// Deletes a bank detail
export const deleteBankDetail = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id as string;
    const id = req.params.id as string;

    const bankDetail = await prisma.bankDetail.findFirst({
      where: { id, userId }
    });

    if (!bankDetail) {
      return res.status(404).json({ message: 'Bank detail not found' });
    }

    await prisma.bankDetail.delete({
      where: { id }
    });

    // If we deleted the default one, pick another one to be default if exists
    if (bankDetail.isDefault) {
      const nextBank = await prisma.bankDetail.findFirst({
        where: { userId }
      });
      if (nextBank) {
        await prisma.bankDetail.update({
          where: { id: nextBank.id },
          data: { isDefault: true }
        });
      }
    }

    return res.status(200).json({ message: 'Bank detail deleted successfully' });
  } catch (error) {
    console.error('deleteBankDetail error:', error);
    return res.status(500).json({ message: 'Error deleting bank detail' });
  }
};
