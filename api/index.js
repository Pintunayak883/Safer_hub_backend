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
require("../config/passport");

const app = express();
app.set("trust proxy", 1);

// CORS - allow the client app
const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/safeherhub", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
app.use("/api/auth", require("../routes/auth"));
app.use("/api/users", require("../routes/users"));
app.use("/api/reports", require("../routes/reports"));
app.use("/api/forums", require("../routes/forums"));
app.use("/api/alerts", require("../routes/alerts"));
app.use("/api/guardians", require("../routes/guardians"));
app.use("/api/pulse", require("../routes/pulse"));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// Export for Vercel serverless
module.exports = app;
