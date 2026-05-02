import express from 'express';
import { getDropMateBankDetails } from '../controllers/dropmateBankController';

const router = express.Router();

router.get('/', getDropMateBankDetails);

export default router;
