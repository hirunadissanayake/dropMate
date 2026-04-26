import { PrismaClient } from '@prisma/client';
import { createNotification } from '../controllers/notificationController';

const prisma = new PrismaClient();

/**
 * Sends a notification to all active administrators.
 */
export const notifyAdmins = async (params: {
  type: 'GENERAL' | 'PROFILE_APPROVED' | 'PROFILE_REJECTED' | 'PARCEL_CREATED' | 'PAYMENT_RECEIVED';
  title: string;
  body: string;
  metadata?: object;
}) => {
  try {
    const admins = await prisma.user.findMany({
      where: { roleActive: 'ADMIN' },
      select: { id: true }
    });

    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        type: params.type,
        title: params.title,
        body: params.body,
        metadata: params.metadata
      });
    }
  } catch (error) {
    console.error('Failed to notify admins:', error);
  }
};
