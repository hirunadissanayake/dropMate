import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import parcelRoutes from './routes/parcelRoutes';
import tripRoutes from './routes/tripRoutes';
import deliveryRoutes from './routes/deliveryRoutes';
import paymentRoutes from './routes/paymentRoutes';
import walletRoutes from './routes/walletRoutes';
import bankRoutes from './routes/bankRoutes';
import notificationRoutes from './routes/notificationRoutes';


import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Adjust this for production
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

import { sendPushNotification } from './utils/firebase';

// Prisma Client
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join', (userId: string) => {
    socket.join(userId);
    console.log(`User ${userId} joined their notification room`);
  });

  // Global Chat Handlers
  socket.on('send_global_message', async (data: any) => {
    try {
      const { message, senderId, senderName, senderRole, type } = data;
      
      const newMessage = await prisma.globalMessage.create({
        data: {
          message,
          senderId,
          senderName,
          senderRole,
          type: type || 'CHAT'
        }
      });

      // Broadcast to ALL connected clients
      io.emit('global_message', {
        ...newMessage,
        timestamp: newMessage.createdAt
      });

      // If it's a broadcast, send Push Notifications to ALL users
      if (type === 'BROADCAST') {
        const users = await prisma.user.findMany({
          where: { fcmToken: { not: null } },
          select: { fcmToken: true, id: true }
        });

        console.log(`Broadcasting push to ${users.length} users...`);

        users.forEach(user => {
          if (user.fcmToken) {
            sendPushNotification(
              user.fcmToken,
              "New Announcement",
              message,
              { 
                type: 'BROADCAST',
                id: newMessage.id,
                senderName: newMessage.senderName
              }
            ).catch(err => console.error(`Push failed for ${user.id}:`, err.message));
          }
        });
      }
    } catch (error) {
      console.error('Error sending global message:', error);
    }
  });

  socket.on('get_global_history', async () => {
    try {
      const history = await prisma.globalMessage.findMany({
        orderBy: { createdAt: 'asc' },
        take: 100 // Last 100 messages
      });
      socket.emit('global_history', history);
    } catch (error) {
      console.error('Error fetching global history:', error);
    }
  });

  socket.on('edit_global_message', async (data: { id: string, message: string }) => {
    try {
      const { id, message } = data;
      const updatedMessage = await prisma.globalMessage.update({
        where: { id },
        data: { message }
      });
      io.emit('global_message_updated', {
        ...updatedMessage,
        timestamp: updatedMessage.updatedAt
      });
    } catch (error) {
      console.error('Error editing global message:', error);
    }
  });

  socket.on('delete_global_message', async (id: string) => {
    try {
      await prisma.globalMessage.delete({ where: { id } });
      io.emit('global_message_deleted', id);
    } catch (error) {
      console.error('Error deleting global message:', error);
    }
  });

  // Support Chat Handlers
  socket.on('send_support_message', async (data: any) => {
    try {
      const { userId, message, isAdmin, senderName } = data;
      
      const supportMsg = await prisma.supportMessage.create({
        data: {
          userId,
          message,
          isAdmin: isAdmin || false,
          senderName
        }
      });

      // Emit to user's personal room
      io.to(userId).emit('support_message', supportMsg);
      
      // Also emit back to the sender specifically to ensure immediate update 
      // even if they haven't joined the room yet or there's a room issue
      socket.emit('support_message', supportMsg);
      
      // Emit to all admins
      io.to('admins').emit('support_message', supportMsg);

      // If from admin to user, send push notification to the user
      if (isAdmin) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { fcmToken: true }
        });
        if (user?.fcmToken) {
          sendPushNotification(
            user.fcmToken,
            "Support Response",
            message,
            { type: 'SUPPORT_CHAT', userId }
          ).catch(err => console.error(`Support push failed:`, err.message));
        }
      } else {
        // From user to admin, maybe notify admins? 
        // Admins already receive the socket event if joined 'admins' room
      }
    } catch (error) {
      console.error('Error sending support message:', error);
    }
  });

  socket.on('get_support_history', async (userId: string) => {
    try {
      const history = await prisma.supportMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' }
      });
      
      // Mark as read when admin fetches history
      await prisma.supportMessage.updateMany({
        where: { userId, isAdmin: false, isRead: false },
        data: { isRead: true }
      });

      socket.emit('support_history', history);
    } catch (error) {
      console.error('Error fetching support history:', error);
    }
  });

  socket.on('mark_support_as_read', async (userId: string) => {
    try {
      await prisma.supportMessage.updateMany({
        where: { userId, isAdmin: false, isRead: false },
        data: { isRead: true }
      });
    } catch (error) {
      console.error('Error marking support as read:', error);
    }
  });

  socket.on('join_admins', () => {
    socket.join('admins');
    console.log(`Socket ${socket.id} joined admins room`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Export io for use in controllers
export { io };

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/parcels', parcelRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/bank-details', bankRoutes);
app.use('/api/notifications', notificationRoutes);


app.get('/', (req, res) => {
  res.send('DropMate API is running!');
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
