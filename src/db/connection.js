const mongoose = require("mongoose");
const logger = require("../logs/logger");

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/extranjeria_bot";
    await mongoose.connect(mongoURI);
    logger.info("✅ Connected to MongoDB");
  } catch (error) {
    logger.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
