import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthRequest extends Request {
  user?: any;
}

export const protect = (req: AuthRequest, res: Response, next: NextFunction) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

export const isApproved = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { roleActive, isCustomerApproved, isTravelerApproved, id } = req.user;

  if (roleActive === 'CUSTOMER') {
    if (isCustomerApproved) return next();
    
    const user = await prisma.user.findUnique({ where: { id } });
    if (user && user.isCustomerApproved) {
      req.user.isCustomerApproved = true;
      return next();
    }
    return res.status(403).json({ message: 'Customer role is not approved. Please contact Admin.' });
  }

  if (roleActive === 'TRAVELER') {
    if (isTravelerApproved) return next();

    const user = await prisma.user.findUnique({ where: { id } });
    if (user && user.isTravelerApproved) {
      req.user.isTravelerApproved = true;
      return next();
    }
    return res.status(403).json({ message: 'Traveler role is not approved. Please contact Admin.' });
  }

  next();
};

export const isCustomer = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.roleActive === 'CUSTOMER') {
    // If token says approved, proceed
    if (req.user.isCustomerApproved) return next();

    // Otherwise, check DB to see if they were just approved
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user && user.isCustomerApproved) {
      // Update req.user so subsequent middlewares see the new status
      req.user.isCustomerApproved = true;
      return next();
    }
  }
  return res.status(403).json({ message: 'Access denied. You must be in an approved Customer mode.' });
};

export const isTraveler = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.roleActive === 'TRAVELER') {
    // If token says approved, proceed
    if (req.user.isTravelerApproved) return next();

    // Otherwise, check DB to see if they were just approved
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user && user.isTravelerApproved) {
      // Update req.user so subsequent middlewares see the new status
      req.user.isTravelerApproved = true;
      return next();
    }
  }
  return res.status(403).json({ message: 'Access denied. You must be in an approved Traveler mode.' });
};

export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.roleActive !== 'ADMIN') {
    return res.status(403).json({ message: 'Only admins can access this resource.' });
  }
  next();
};
