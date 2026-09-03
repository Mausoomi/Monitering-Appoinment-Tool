require("dotenv").config();
const app = require("./src/server/app");
const connectDB = require("./src/db/connection");
const logger = require("./src/logs/logger");

const PORT = process.env.PORT || 10000;

async function startServer() {
  try {
    logger.info("Connecting to MongoDB Atlas...");
    await connectDB();
    logger.info("Connected to MongoDB Atlas!");

    app.listen(PORT, "0.0.0.0", () => {
      logger.info(`🚀 Web Dashboard API Server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

startServer();
