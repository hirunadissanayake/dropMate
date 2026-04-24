import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * GET /api/notifications
 * Returns all notifications for the logged-in user, newest first.
 */
export const getNotifications = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    res.status(200).json({ notifications, unreadCount });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching notifications', error: error.message });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read.
 */
export const markAsRead = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== userId) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.status(200).json({ message: 'Notification marked as read' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating notification', error: error.message });
  }
};

/**
 * PATCH /api/notifications/read-all
 * Marks all notifications for the logged-in user as read.
 */
export const markAllAsRead = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error updating notifications', error: error.message });
  }
};

/**
 * DELETE /api/notifications/:id
 * Deletes a single notification.
 */
export const deleteNotification = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== userId) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    await prisma.notification.delete({ where: { id } });

    res.status(200).json({ message: 'Notification deleted' });
  } catch (error: any) {
    res.status(500).json({ message: 'Error deleting notification', error: error.message });
  }
};

/**
 * Internal helper — call this from other controllers to create a notification.
 */
export const createNotification = async (params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: object;
}) => {
  await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type as any,
      title: params.title,
      body: params.body,
      metadata: params.metadata ?? {},
    },
  });
};
