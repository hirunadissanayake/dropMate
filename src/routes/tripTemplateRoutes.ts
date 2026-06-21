import express from 'express';
import { createTemplate, getMyTemplates, deleteTemplate, updateTemplate } from '../controllers/tripTemplateController';
import { protect, isTraveler } from '../middlewares/authMiddleware';

const router = express.Router();

router.use(protect);
router.use(isTraveler);

router.post('/create', createTemplate);
router.get('/my', getMyTemplates);
router.put('/:id', updateTemplate);
router.delete('/:id', deleteTemplate);


export default router;
