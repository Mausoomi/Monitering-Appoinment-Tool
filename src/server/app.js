const express = require("express");
const cors = require("cors");
const path = require("path");
const Job = require("../db/models/Job");
const logger = require("../logs/logger");
const activeContexts = require("../browser/activeContexts");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, "../../public")));

// API Endpoints

// Get all jobs (for dashboard/monitoring)
app.get("/api/jobs", async (req, res) => {
  try {
    const jobs = await Job.find().sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    logger.error(`Error fetching jobs: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch jobs" });
  }
});

// Add a new job from the frontend form
app.post("/api/jobs", async (req, res) => {
  try {
    const { province, tramite, oficina, docType, passportNumber, nieNumber, dniNumber, name, birthYear, nationality, expiryDate, phone, email, preferredDate, preferredTime } = req.body;

    if (!province || !tramite || !name) {
      return res.status(400).json({ error: "Missing required fields: province, tramite, or name." });
    }
    if (!passportNumber && !nieNumber && !dniNumber) {
      return res.status(400).json({ error: "At least one document number (Passport, NIE, or DNI) must be provided." });
    }

    const newJob = new Job({
      province,
      tramite,
      oficina: oficina || "",
      docType: docType || "N.I.E.",
      passportNumber: passportNumber || "",
      nieNumber: nieNumber || "",
      dniNumber: dniNumber || "",
      name,
      birthYear: birthYear || "",
      nationality: nationality || "",
      expiryDate: expiryDate || "",
      phone: phone || "",
      email: email || "",
      preferredDate: preferredDate || "",
      preferredTime: preferredTime || "",
      status: "pending",
    });

    await newJob.save();
    logger.info(`✅ New Job queued for ${name} (${province} - ${tramite})`);
    
    res.status(201).json({ message: "Job successfully added to the queue", job: newJob });
  } catch (err) {
    logger.error(`Error adding job: ${err.message}`);
    res.status(500).json({ error: "Failed to queue the job" });
  }
});

// Edit an existing job
app.put("/api/jobs/:id", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const { province, tramite, oficina, docType, passportNumber, nieNumber, dniNumber, name, birthYear, nationality, expiryDate, phone, email, preferredDate, preferredTime } = req.body;

    if (!province || !tramite || !name) {
      return res.status(400).json({ error: "Missing required fields: province, tramite, or name." });
    }
    if (!passportNumber && !nieNumber && !dniNumber) {
      return res.status(400).json({ error: "At least one document number (Passport, NIE, or DNI) must be provided." });
    }

    job.province = province;
    job.tramite = tramite;
    job.oficina = oficina || "";
    job.docType = docType || "N.I.E.";
    job.passportNumber = passportNumber || "";
    job.nieNumber = nieNumber || "";
    job.dniNumber = dniNumber || "";
    job.name = name;
    job.birthYear = birthYear || "";
    job.nationality = nationality || "";
    job.expiryDate = expiryDate || "";
    job.phone = phone || "";
    job.email = email || "";
    job.preferredDate = preferredDate || "";
    job.preferredTime = preferredTime || "";
    job.status = "pending"; // Reset to pending after edit
    job.failureReason = "";

    await job.save();
    logger.info(`✏️ Job updated and set to pending for ${name} (${province} - ${tramite})`);
    
    res.json({ message: "Job successfully updated", job });
  } catch (err) {
    logger.error(`Error updating job: ${err.message}`);
    res.status(500).json({ error: "Failed to update the job" });
  }
});

// Delete a job
app.delete("/api/jobs/:id", async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: "Job deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete job" });
  }
});

// Retry a job (reset to pending)
app.put("/api/jobs/:id/retry", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    
    job.status = "pending";
    job.failureReason = "";
    await job.save();
    
    logger.info(`🔄 Job retried and added back to queue: ${job.name}`);
    res.json({ message: "Job successfully requeued" });
  } catch (err) {
    logger.error(`Error retrying job: ${err.message}`);
    res.status(500).json({ error: "Failed to retry job" });
  }
});

// Stop/cancel a processing job
app.put("/api/jobs/:id/stop", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    job.status = "failed";
    job.failureReason = "Stopped by user";
    await job.save();

    // Check if there is an active browser context for this job and close it
    const activeContext = activeContexts.get(req.params.id);
    if (activeContext) {
      logger.info(`Stopping active browser context for job: ${job.name}`);
      await activeContext.close().catch(() => {});
      activeContexts.delete(req.params.id);
    }

    logger.info(`⏹️ Job stopped manually by user: ${job.name}`);
    res.json({ message: "Job successfully stopped" });
  } catch (err) {
    logger.error(`Error stopping job: ${err.message}`);
    res.status(500).json({ error: "Failed to stop job" });
  }
});

// Webhook for receiving incoming SMS OTPs from client forwarding apps
app.post("/api/incoming-otp", async (req, res) => {
  try {
    const payload = req.body;
    logger.info(`[WEBHOOK] Received incoming SMS payload: ${JSON.stringify(payload)}`);

    const from = payload.from || payload.sender || payload.phone || "";
    const to = payload.to || payload.receiver || payload.dest || "";
    const message = payload.message || payload.text || payload.msg || payload.body || "";

    if (!message) {
      return res.status(400).json({ error: "No message text found in payload" });
    }

    // Match OTP digits (usually 4 to 8 digits)
    const otpMatch = message.match(/\b(\d{4,8})\b/);
    if (!otpMatch) {
      logger.warn(`[WEBHOOK] Could not extract OTP code from message: "${message}"`);
      return res.status(400).json({ error: "Could not extract OTP code from message" });
    }
    const otpCode = otpMatch[1];
    logger.info(`[WEBHOOK] Extracted OTP code: ${otpCode}`);

    // Clean phone numbers to match (remove non-digits and leading +34/34/0034)
    const cleanNumber = (num) => num.replace(/\D/g, "").replace(/^(0034|34)/, "");

    let matchedJob = null;

    if (to) {
      const targetTo = cleanNumber(to);
      logger.info(`[WEBHOOK] Searching active jobs matching phone suffix: ${targetTo}`);
      const activeJobs = await Job.find({ status: "processing" });
      matchedJob = activeJobs.find(j => j.phone && (cleanNumber(j.phone).endsWith(targetTo) || targetTo.endsWith(cleanNumber(j.phone))));
    }

    // Fallback: If no match by phone number, match any processing job
    if (!matchedJob) {
      logger.info(`[WEBHOOK] No direct phone match found. Checking for any active processing job...`);
      matchedJob = await Job.findOne({ status: "processing" }).sort({ updatedAt: -1 });
    }

    if (!matchedJob) {
      logger.warn("[WEBHOOK] No active processing job found to assign this OTP to.");
      return res.status(404).json({ error: "No active processing job found" });
    }

    matchedJob.otpCode = otpCode;
    await matchedJob.save();
    logger.info(`[WEBHOOK] Successfully saved OTP ${otpCode} to Job: ${matchedJob.name} (${matchedJob.phone})`);

    res.json({ success: true, message: `OTP successfully saved to Job: ${matchedJob.name}` });
  } catch (err) {
    logger.error(`[WEBHOOK ERROR] Failed to process incoming OTP: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = app;
