const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const { socketAuth } = require("./middleware/auth");
const User = require("./models/User");
const Message = require("./models/Message");
const Conversation = require("./models/Conversation");

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json());

// Health check route
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "API is running..." });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api", chatRoutes);

// Connect DB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Socket.io JWT authentication middleware
io.use(socketAuth);

// Track online users with their socket IDs
const onlineUsers = new Map();

// Socket.io connection handling
io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.user.username} (${socket.id})`);

  // Track user's socket
  onlineUsers.set(socket.userId.toString(), socket.id);

  // Update user online status
  await User.findByIdAndUpdate(socket.userId, { isOnline: true });

  // Join user's personal room for receiving messages
  socket.join(socket.userId.toString());

  // Broadcast user online status
  socket.broadcast.emit("user_online", {
    userId: socket.userId,
    username: socket.user.username
  });

  // Join conversation rooms
  socket.on("join_conversation", async (conversationId) => {
    // Verify user is participant
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: socket.userId
    });
    
    if (conversation) {
      socket.join(conversationId);
      console.log(`${socket.user.username} joined conversation: ${conversationId}`);
    }
  });

  // Leave conversation room
  socket.on("leave_conversation", (conversationId) => {
    socket.leave(conversationId);
  });

  // Handle sending messages (real-time + persist)
  socket.on("send_message", async (data) => {
    try {
      const { conversationId, content } = data;

      // Verify user is participant
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) return;

      // Save message to database
      const message = await Message.create({
        conversation: conversationId,
        sender: socket.userId,
        content: content.trim(),
        readBy: [socket.userId]
      });

      // Update conversation's last message
      conversation.lastMessage = message._id;
      await conversation.save();

      // Populate sender info
      await message.populate('sender', 'username');

      const messageData = {
        _id: message._id,
        conversation: conversationId,
        sender: {
          _id: socket.userId,
          username: socket.user.username
        },
        content: message.content,
        createdAt: message.createdAt
      };

      // Send to all participants in the conversation room
      io.to(conversationId).emit("new_message", messageData);

      // Also notify participants who might not be in the room
      conversation.participants.forEach(participantId => {
        const oderId = participantId.toString();
        if (oderId !== socket.userId.toString()) {
          io.to(oderId).emit("message_notification", {
            conversationId,
            message: messageData
          });
        }
      });

    } catch (error) {
      console.error("Send message socket error:", error);
    }
  });

  // Handle typing indicator
  socket.on("typing", (data) => {
    socket.to(data.conversationId).emit("user_typing", {
      conversationId: data.conversationId,
      userId: socket.userId,
      username: socket.user.username,
      isTyping: data.isTyping
    });
  });

  // Handle marking messages as read
  socket.on("mark_as_read", async (data) => {
    try {
      const { conversationId, messageIds } = data;

      // Verify user is participant
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) return;

      // Update all specified messages
      await Message.updateMany(
        { 
          _id: { $in: messageIds },
          conversation: conversationId,
          sender: { $ne: socket.userId } // Can't mark own messages as read
        },
        { $addToSet: { readBy: socket.userId } }
      );

      // Notify other participants about read receipts
      socket.to(conversationId).emit("messages_read", {
        conversationId,
        messageIds,
        readBy: {
          _id: socket.userId,
          username: socket.user.username
        }
      });

    } catch (error) {
      console.error("Mark as read error:", error);
    }
  });

  // Handle disconnect
  socket.on("disconnect", async () => {
    console.log(`User disconnected: ${socket.user.username}`);
    onlineUsers.delete(socket.userId.toString());
    await User.findByIdAndUpdate(socket.userId, { isOnline: false });
    socket.broadcast.emit("user_offline", {
      userId: socket.userId,
      username: socket.user.username
    });
  });
});

// Make io accessible to routes if needed
app.set("io", io);

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));