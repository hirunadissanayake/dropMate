import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { io } from '../index';

const prisma = new PrismaClient();

/**
 * GET /api/notifications?page=1&limit=10
 * Returns paginated notifications for the logged-in user, newest first.
 */
export const getNotifications = async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    res.status(200).json({
      notifications,
      unreadCount,
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    });
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
    const id = req.params.id as string;

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
    const id = req.params.id as string;

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

import { sendPushNotification } from '../utils/firebase';

// Internal helper — call this from other controllers to create a notification.
 
export const createNotification = async (params: {
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: object;
}) => {
  // 1. Create in-app notification in DB
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type as any,
      title: params.title,
      body: params.body,
      metadata: params.metadata ?? {},
    },
  });

  // 1.5 Emit Socket.io event for real-time dashboard updates
  try {
    io.to(params.userId).emit('new_notification', notification);
    console.log(`Emitted real-time notification to user ${params.userId}`);
  } catch (socketError) {
    console.error('Failed to emit socket notification:', socketError);
  }

  // 2. Try to send Push Notification if user has an FCM token
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { fcmToken: true }
    });

    if (user?.fcmToken) {
      // The original push can race with withdrawal while its notification/token
      // are being loaded. Never send a new parcel alert for a closed match.
      const matchId = (params.metadata as any)?.matchId;
      if (params.type === 'DELIVERY_REQUEST' && typeof matchId === 'string') {
        const pending = await prisma.match.findFirst({
          where: { id: matchId, status: 'PENDING', parcel: { status: 'PENDING' } },
          select: { id: true },
        });
        if (!pending) return;
      }
      console.log(`📡 Sending Push Notification to user ${params.userId}...`);
      
      // Use custom sound for high-priority delivery requests
      const sound = params.type === 'DELIVERY_REQUEST' ? 'request_alert.mp3' : undefined;

      // Ensure all metadata values are strings for FCM compatibility
      const fcmData: any = { 
        notificationId: notification.id,
        type: params.type,
        ...params.metadata 
      };

      // Use matchId as tag for grouping/cancelling notifications
      const tag = (params.metadata as any)?.matchId ? `match_${(params.metadata as any).matchId}` : undefined;

      await sendPushNotification(
        user.fcmToken,
        params.title,
        params.body,
        fcmData,
        sound,
        tag
      );
    } else {
      console.log(`⚠️ No FCM token found for user ${params.userId}. Push notification skipped.`);
    }
  } catch (pushError) {
    console.error('Failed to send push notification:', pushError);
  }
};

/**
 * POST /api/notifications/broadcast
 * Sends a notification to ALL users.
 */
export const sendBroadcast = async (req: Request, res: Response) => {
  try {
    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({ message: 'Title and body are required' });
    }

    // 1. Get all users
    const users = await prisma.user.findMany({
      select: { id: true, fcmToken: true }
    });

    // 2. Create notification records in DB
    const notificationData = users.map((user: any) => ({
      userId: user.id,
      type: 'GENERAL' as any,
      title,
      body,
    }));

    await prisma.notification.createMany({
      data: notificationData
    });

    // 3. Emit real-time global event
    io.emit('broadcast_notification', { title, body });

    // 4. Send Push Notifications (async background)
    users.forEach((user: any) => {
      if (user.fcmToken) {
        sendPushNotification(user.fcmToken, title, body, { type: 'GENERAL' }).catch(err => {
          console.error(`Failed to send broadcast push to ${user.id}:`, err.message);
        });
      }
    });

    res.status(200).json({ message: 'Broadcast sent successfully', count: users.length });
  } catch (error: any) {
    res.status(500).json({ message: 'Error sending broadcast', error: error.message });
  }
};
