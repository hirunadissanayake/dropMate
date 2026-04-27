import { Router } from 'express';
import { 
  getNotifications, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification,
  sendBroadcast
} from '../controllers/notificationController';
import { protect } from '../middlewares/authMiddleware';

const router = Router();

router.use(protect);


router.get('/', getNotifications);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);
router.post('/broadcast', sendBroadcast);

export default router;
