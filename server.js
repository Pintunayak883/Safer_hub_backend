const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const http = require("http");
const socketIo = require("socket.io");
const passport = require("passport");
const path = require("path");
require("dotenv").config();

// Passport configuration
require("./config/passport");

const app = express();
app.set("trust proxy", 1);
// CORS - allow the client app during development
const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
};
app.use(require('cors')(corsOptions));
// respond to preflight requests
app.options('*', require('cors')(corsOptions));
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Expose io via app settings so routes can use it without circular requires
app.set("io", io);

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Passport middleware
app.use(passport.initialize());

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/safeherhub", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/forums", require("./routes/forums"));
app.use("/api/alerts", require("./routes/alerts"));
app.use("/api/guardians", require("./routes/guardians"));
app.use("/api/pulse", require("./routes/pulse"));

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join user to their personal room
  socket.on("join-user-room", (userId) => {
    socket.join(`user-${userId}`);
  });

  // Join forum room
  socket.on("join-forum", (forumId) => {
    socket.join(`forum-${forumId}`);
  });

  // Handle whisper alert chain
  socket.on("whisper-alert", (data) => {
    // Broadcast to trusted contacts
    data.contacts.forEach((contactId) => {
      socket.to(`user-${contactId}`).emit("whisper-alert-received", data);
    });
  });

  // Handle forum messages
  socket.on("forum-message", (data) => {
    socket.to(`forum-${data.forumId}`).emit("new-forum-message", data);
  });

  // Handle pulse check responses
  socket.on("pulse-response", (data) => {
    socket.to(`user-${data.userId}`).emit("pulse-updated", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static("../client/build"));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/build", "index.html"));
  });
}

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = server;
