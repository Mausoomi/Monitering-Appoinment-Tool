const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    province: {
      type: String,
      required: true,
    },
    tramite: {
      type: String,
      required: true,
    },
    docType: {
      type: String,
      enum: ["PASAPORTE", "N.I.E.", "D.N.I."],
      default: "N.I.E.",
    },
    passportNumber: {
      type: String,
      default: "",
    },
    nieNumber: {
      type: String,
      default: "",
    },
    dniNumber: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      required: true,
    },
    birthYear: {
      type: String,
      default: "", // Some tramites need this
    },
    nationality: {
      type: String,
      default: "", // Some tramites need this
    },
    expiryDate: {
      type: String,
      default: "", // Some tramites need this
    },
    phone: {
      type: String,
      default: "", // Phone number for Contact Details step
    },
    email: {
      type: String,
      default: "", // Email for Contact Details step
    },
    oficina: {
      type: String,
      default: "", // To select specific police station
    },
    preferredDate: {
      type: String,
      default: "", // User's preferred date (YYYY-MM-DD)
    },
    preferredTime: {
      type: String,
      default: "", // User's preferred time (HH:MM)
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    lastAttempted: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: "",
    },
    otpCode: {
      type: String,
      default: "", // Stores the dynamically received OTP from client webhook
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Job", jobSchema);
