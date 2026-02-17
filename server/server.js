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


// ✅ ALLOWED ORIGINS (LOCAL + PRODUCTION)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.CLIENT_URL // Vercel URL
];


// ✅ SOCKET.IO SETUP (FIXED CORS)
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Socket CORS not allowed"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});


// ✅ EXPRESS CORS (FIXED)
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  credentials: true
}));

app.use(express.json());


// ✅ HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "API is running..." });
});


// ✅ ROUTES
app.use("/api/auth", authRoutes);
app.use("/api", chatRoutes);


// ✅ DATABASE
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));


// ✅ SOCKET AUTH
io.use(socketAuth);


// ✅ ONLINE USERS TRACK
const onlineUsers = new Map();


// ✅ SOCKET CONNECTION
io.on("connection", async (socket) => {
  console.log(`User connected: ${socket.user.username} (${socket.id})`);

  onlineUsers.set(socket.userId.toString(), socket.id);

  await User.findByIdAndUpdate(socket.userId, { isOnline: true });

  socket.join(socket.userId.toString());

  socket.broadcast.emit("user_online", {
    userId: socket.userId,
    username: socket.user.username
  });


  // JOIN CONVERSATION
  socket.on("join_conversation", async (conversationId) => {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: socket.userId
    });

    if (conversation) {
      socket.join(conversationId);
      console.log(`${socket.user.username} joined conversation: ${conversationId}`);
    }
  });


  // LEAVE CONVERSATION
  socket.on("leave_conversation", (conversationId) => {
    socket.leave(conversationId);
  });


  // SEND MESSAGE
  socket.on("send_message", async (data) => {
    try {
      const { conversationId, content } = data;

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) return;

      const message = await Message.create({
        conversation: conversationId,
        sender: socket.userId,
        content: content.trim(),
        readBy: [socket.userId]
      });

      conversation.lastMessage = message._id;
      await conversation.save();

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

      io.to(conversationId).emit("new_message", messageData);

      conversation.participants.forEach(participantId => {
        const otherId = participantId.toString();
        if (otherId !== socket.userId.toString()) {
          io.to(otherId).emit("message_notification", {
            conversationId,
            message: messageData
          });
        }
      });

    } catch (error) {
      console.error("Send message socket error:", error);
    }
  });


  // TYPING
  socket.on("typing", (data) => {
    socket.to(data.conversationId).emit("user_typing", {
      conversationId: data.conversationId,
      userId: socket.userId,
      username: socket.user.username,
      isTyping: data.isTyping
    });
  });


  // MARK AS READ
  socket.on("mark_as_read", async (data) => {
    try {
      const { conversationId, messageIds } = data;

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.userId
      });

      if (!conversation) return;

      await Message.updateMany(
        {
          _id: { $in: messageIds },
          conversation: conversationId,
          sender: { $ne: socket.userId }
        },
        { $addToSet: { readBy: socket.userId } }
      );

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


  // DISCONNECT
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


// ✅ MAKE IO AVAILABLE
app.set("io", io);


// ✅ START SERVER
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));