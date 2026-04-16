import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export const isApproved = (req: AuthRequest, res: Response, next: NextFunction) => {
  const { roleActive, isCustomerApproved, isTravelerApproved } = req.user;

  if (roleActive === 'CUSTOMER' && !isCustomerApproved) {
    return res.status(403).json({ message: 'Customer role is not approved. Please contact Admin.' });
  }

  if (roleActive === 'TRAVELER' && !isTravelerApproved) {
    return res.status(403).json({ message: 'Traveler role is not approved. Please contact Admin.' });
  }

  next();
};

export const isCustomer = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.roleActive === 'CUSTOMER' && req.user.isCustomerApproved) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied. You must be in an approved Customer mode.' });
};

export const isTraveler = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.roleActive === 'TRAVELER' && req.user.isTravelerApproved) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied. You must be in an approved Traveler mode.' });
};

export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.roleActive !== 'ADMIN') {
    return res.status(403).json({ message: 'Only admins can access this resource.' });
  }
  next();
};
