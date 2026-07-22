import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "./config/database.js";
import chatRoutes from "./routes/chat.js";
import authRoutes from "./routes/auth.js";
import itineraryRoutes from "./routes/itinerary.js";
import travelRoutes from "./routes/travel.js";
import flightRoutes from "./routes/flights.js";
import savedTripRoutes from "../routes/savedTripRoutes.js";
import placesRoutes from "../routes/placesRoutes.js";
import { authenticateToken } from "./middleware/auth.js";
import { setSocketIO } from "./controllers/chatController.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Debug: Verify env vars are loaded
console.log("🔑 Environment check:");
console.log(
  "  - OPENAI_API_KEY:",
  process.env.OPENAI_API_KEY ? "✅ Loaded" : "❌ Missing"
);
console.log(
  "  - OPENTRIPMAP_API_KEY:",
  process.env.OPENTRIPMAP_API_KEY ? "✅ Loaded" : "❌ Missing"
);
console.log(
  "  - AMADEUS_API_KEY:",
  process.env.AMADEUS_API_KEY ? "✅ Loaded" : "⚠️  Missing (optional)"
);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  },
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.get("/api", (req, res) => {
  res.json({ message: "TripWhat API is running" });
});

// Auth routes (public)
app.use("/api/auth", authRoutes);

// Places routes (public - for search)
app.use("/api/places", placesRoutes);

// Protected routes
app.use("/api/chat", authenticateToken, chatRoutes);
app.use("/api/itinerary", authenticateToken, itineraryRoutes);
app.use("/api/travel", travelRoutes);
app.use("/api/saved-trips", savedTripRoutes);

// Flights routes (public for now - can add auth later)
app.use("/api/flights", flightRoutes);

// Set Socket.io instance for chat controller
setSocketIO(io);

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Join conversation room
  socket.on("join:conversation", (conversationId: string) => {
    socket.join(conversationId);
    console.log(
      `📝 Socket ${socket.id} joined conversation: ${conversationId}`
    );
  });

  // Leave conversation room
  socket.on("leave:conversation", (conversationId: string) => {
    socket.leave(conversationId);
    console.log(`👋 Socket ${socket.id} left conversation: ${conversationId}`);
  });

  socket.on("disconnect", () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Error handling middleware
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  }
);

const PORT = 5000;

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 Socket.io listening for connections`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export { io };
