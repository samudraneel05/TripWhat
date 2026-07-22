import { Router } from 'express';
import * as chatController from '../controllers/chatController.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * Chat Routes
 */

// Create a new conversation
router.post('/conversation', (req, res) => {
  const conversationId = uuidv4();
  res.status(201).json({ conversationId });
});

// Send a message (alias routes for compatibility)
router.post('/', chatController.sendMessage);
router.post('/message', chatController.sendMessage);

// Sync itinerary from form flow
router.post('/sync-itinerary', chatController.syncItinerary);

// Modify itinerary
router.post('/modify-itinerary', chatController.modifyItinerary);

// Get conversation history (alias routes for compatibility)
router.get('/history/:conversationId', chatController.getConversation);
router.get('/:conversationId', chatController.getConversation);

// Delete conversation
router.delete('/:conversationId', chatController.deleteConversation);

// List all conversations (must be last to avoid route conflicts)
// router.get('/', chatController.listConversations);

export default router;
