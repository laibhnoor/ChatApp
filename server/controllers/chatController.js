const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

// @desc    Get all conversations for current user
// @route   GET /api/conversations
// @access  Private
const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.userId
    })
      .populate('participants', 'username isOnline')
      .populate('lastMessage')
      .populate('admin', 'username')
      .sort({ updatedAt: -1 });

    res.json({ success: true, conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get or create a DM conversation
// @route   POST /api/conversations/dm/:userId
// @access  Private
const getOrCreateDM = async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId === req.userId.toString()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot create conversation with yourself' 
      });
    }

    const otherUser = await User.findById(userId);
    if (!otherUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const conversation = await Conversation.findOrCreateDM(req.userId, userId);

    res.json({ success: true, conversation });
  } catch (error) {
    console.error('Get/create DM error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Create a group conversation
// @route   POST /api/conversations/group
// @access  Private
const createGroup = async (req, res) => {
  try {
    const { name, participants } = req.body;

    if (!name || !participants || participants.length < 1) {
      return res.status(400).json({ 
        success: false, 
        message: 'Group name and at least 1 other participant required' 
      });
    }

    // Add current user to participants
    const allParticipants = [...new Set([req.userId.toString(), ...participants])];

    const conversation = await Conversation.create({
      name,
      isGroup: true,
      participants: allParticipants,
      admin: req.userId
    });

    await conversation.populate('participants', 'username isOnline');
    await conversation.populate('admin', 'username');

    res.status(201).json({ success: true, conversation });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get messages for a conversation
// @route   GET /api/conversations/:id/messages
// @access  Private
const getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50, before } = req.query;

    // Verify user is participant
    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    const query = { conversation: id };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('sender', 'username')
      .populate('readBy', '_id username')
      .lean();

    res.json({ success: true, messages: messages.reverse() });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Send a message
// @route   POST /api/conversations/:id/messages
// @access  Private
const sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message content required' 
      });
    }

    // Verify user is participant
    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    const message = await Message.create({
      conversation: id,
      sender: req.userId,
      content: content.trim(),
      readBy: [req.userId]
    });

    // Update conversation's last message
    conversation.lastMessage = message._id;
    await conversation.save();

    await message.populate('sender', 'username');

    res.status(201).json({ success: true, message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get all users (for starting new conversations)
// @route   GET /api/users
// @access  Private
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } })
      .select('username isOnline')
      .sort({ username: 1 });

    res.json({ success: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Add user to group
// @route   POST /api/conversations/:id/participants
// @access  Private
const addToGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const conversation = await Conversation.findOne({
      _id: id,
      isGroup: true,
      admin: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Group not found or not authorized' 
      });
    }

    if (conversation.participants.includes(userId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'User already in group' 
      });
    }

    conversation.participants.push(userId);
    await conversation.save();
    await conversation.populate('participants', 'username isOnline');

    res.json({ success: true, conversation });
  } catch (error) {
    console.error('Add to group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Leave group
// @route   DELETE /api/conversations/:id/participants
// @access  Private
const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await Conversation.findOne({
      _id: id,
      isGroup: true,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Group not found' 
      });
    }

    conversation.participants = conversation.participants.filter(
      p => p.toString() !== req.userId.toString()
    );

    // If admin leaves, assign new admin
    if (conversation.admin.toString() === req.userId.toString()) {
      conversation.admin = conversation.participants[0] || null;
    }

    await conversation.save();

    res.json({ success: true, message: 'Left group successfully' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Mark messages as read
// @route   POST /api/conversations/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify user is participant
    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    // Mark all unread messages from others as read
    const result = await Message.updateMany(
      { 
        conversation: id,
        sender: { $ne: req.userId },
        readBy: { $ne: req.userId }
      },
      { $addToSet: { readBy: req.userId } }
    );

    res.json({ 
      success: true, 
      markedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get unread count for all conversations
// @route   GET /api/conversations/unread
// @access  Private
const getUnreadCounts = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.userId
    }).select('_id');

    const conversationIds = conversations.map(c => c._id);

    // Aggregate unread counts per conversation
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          conversation: { $in: conversationIds },
          sender: { $ne: req.userId },
          readBy: { $ne: req.userId }
        }
      },
      {
        $group: {
          _id: '$conversation',
          count: { $sum: 1 }
        }
      }
    ]);

    // Convert to object keyed by conversation ID
    const counts = {};
    unreadCounts.forEach(item => {
      counts[item._id.toString()] = item.count;
    });

    res.json({ success: true, counts });
  } catch (error) {
    console.error('Get unread counts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Upload file and send as message
// @route   POST /api/conversations/:id/upload
// @access  Private
const uploadFile = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body; // Optional text with file

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Verify user is participant
    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.userId
    });

    if (!conversation) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    // Determine file type from mimetype
    let fileType = 'document';
    if (req.file.mimetype.startsWith('image/')) {
      fileType = 'image';
    } else if (req.file.mimetype.startsWith('video/')) {
      fileType = 'video';
    } else if (req.file.mimetype.startsWith('audio/')) {
      fileType = 'audio';
    }

    const message = await Message.create({
      conversation: id,
      sender: req.userId,
      content: content?.trim() || null,
      fileUrl: req.file.path,
      fileType,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      cloudinaryId: req.file.filename,
      readBy: [req.userId]
    });

    // Update conversation's last message
    conversation.lastMessage = message._id;
    await conversation.save();

    await message.populate('sender', 'username');

    // Emit via Socket.IO if available
    const io = req.app.get('io');
    if (io) {
      const messageData = {
        _id: message._id,
        conversation: id,
        sender: {
          _id: req.userId,
          username: message.sender.username
        },
        content: message.content,
        fileUrl: message.fileUrl,
        fileType: message.fileType,
        fileName: message.fileName,
        fileSize: message.fileSize,
        createdAt: message.createdAt
      };

      io.to(id).emit('new_message', messageData);

      // Notify participants not in room
      conversation.participants.forEach(participantId => {
        const oderId = participantId.toString();
        if (oderId !== req.userId.toString()) {
          io.to(oderId).emit('message_notification', {
            conversationId: id,
            message: messageData
          });
        }
      });
    }

    res.status(201).json({ success: true, message });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
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
};
