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


dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
