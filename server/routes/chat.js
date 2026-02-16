const express = require('express');
const {
  getConversations,
  getOrCreateDM,
  createGroup,
  getMessages,
  sendMessage,
  getUsers,
  addToGroup,
  leaveGroup,
  markAsRead,
  getUnreadCounts,
  uploadFile
} = require('../controllers/chatController');
const { protect } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

const router = express.Router();

// All routes are protected
router.use(protect);

// Users
router.get('/users', getUsers);

// Conversations
router.get('/conversations', getConversations);
router.get('/conversations/unread', getUnreadCounts);
router.post('/conversations/dm/:userId', getOrCreateDM);
router.post('/conversations/group', createGroup);

// Messages
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendMessage);
router.post('/conversations/:id/upload', upload.single('file'), uploadFile);
router.post('/conversations/:id/read', markAsRead);

// Group management
router.post('/conversations/:id/participants', addToGroup);
router.delete('/conversations/:id/participants', leaveGroup);

module.exports = router;
