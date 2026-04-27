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
