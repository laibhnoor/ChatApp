const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  }
}, {
  timestamps: true
});

// Index for efficient user conversation lookups
conversationSchema.index({ participants: 1 });

// Get or create a 1-to-1 conversation
conversationSchema.statics.findOrCreateDM = async function(userId1, userId2) {
  // Sort IDs to ensure consistent lookup
  const participants = [userId1, userId2].sort();
  
  let conversation = await this.findOne({
    isGroup: false,
    participants: { $all: participants, $size: 2 }
  }).populate('participants', 'username isOnline')
    .populate('lastMessage');
  
  if (!conversation) {
    conversation = await this.create({
      isGroup: false,
      participants
    });
    conversation = await conversation.populate('participants', 'username isOnline');
  }
  
  return conversation;
};

module.exports = mongoose.model('Conversation', conversationSchema);
