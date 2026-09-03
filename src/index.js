const launchBrowser = require("./browser/browserManager");
const config = require("./config/config");
const domDetector = require("./monitor/domDetector");
const { startTimer, endTimer } = require("./latency/latencyTracker");
const monitorLoop = require("./monitor/monitorLoop");
const logger = require("./logs/logger");
const xhrDetector = require("./monitor/xhrDetector");
const slotMonitor = require("./monitor/slotMonitor");
const logLatency = require("./logs/latencyLogger");
const icpBookingFlow = require("./booking/icpBookingFlow");
const activeContexts = require("./browser/activeContexts");

// Backend integration
const { sendTelegramNotification } = require("./notifications/telegram");
const connectDB = require("./db/connection");
const Job = require("./db/models/Job");
const app = require("./server/app");
const mongoose = require("mongoose");

// Prevent background Playwright/CDP connection errors from crashing the Node.js process during restarts
process.on("unhandledRejection", (reason, promise) => {
  logger.error(`Unhandled Rejection (Ignored): ${reason}`);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  if (err.code === "EADDRINUSE" || err.message.includes("EADDRINUSE")) {
    logger.error("❌ Port already in use. Another instance of the orchestrator is likely running. Exiting to prevent duplicates.");
    process.exit(1);
  }
});

(async () => {
  logger.info("Starting App Orchestrator...");

  // Connect to DB and Start API Server
  await connectDB();

  // Automatically reset all jobs to failed on startup to prevent auto-triggering
  try {
    const resetResult = await Job.updateMany(
      { status: { $ne: "completed" } },
      { status: "failed", failureReason: "Server restarted" }
    );
    if (resetResult.modifiedCount > 0) {
      logger.info(`Reset ${resetResult.modifiedCount} jobs to failed on startup.`);
    }
  } catch (dbErr) {
    logger.error(`Failed to reset jobs on startup: ${dbErr.message}`);
  }

  const PORT = process.env.PORT || 3000;
  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`✅ Web Dashboard running at http://localhost:${PORT}`);
  });
  serverInstance.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`❌ Port ${PORT} is already in use by another process! Exiting to prevent duplicate orchestrator runs.`);
      process.exit(1);
    }
  });

  // Spawn localtunnel to expose the webhook endpoint to the internet under a stable, permanent subdomain
  const { spawn } = require("child_process");
  const ltSubdomain = "mx-otp-forwarder-883a";
  logger.info(`[TUNNEL] Starting Localtunnel on port ${PORT} with subdomain ${ltSubdomain}...`);
  const ltProcess = spawn("npx", ["-y", "localtunnel", "--port", PORT.toString(), "--subdomain", ltSubdomain], {
    shell: true
  });

  ltProcess.stdout.on("data", (data) => {
    const output = data.toString().trim();
    if (output) {
      logger.info(`[TUNNEL]: ${output}`);
    }
  });

  ltProcess.stderr.on("data", (data) => {
    const errorOutput = data.toString().trim();
    if (errorOutput && !errorOutput.includes("Notice")) {
      logger.error(`[TUNNEL ERROR]: ${errorOutput}`);
    }
  });

  // Automation is DISABLED by default unless explicitly enabled
  const enableAutomation = 
    process.env.ENABLE_AUTOMATION === "true" || 
    process.argv.includes("--run-automation");

  if (!enableAutomation) {
    logger.info("Automation loop is disabled by default. Only the Web Dashboard is running. To enable automation, run with '--run-automation' or set ENABLE_AUTOMATION=true in your .env file.");
    return;
  }

  global.automationStats = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    waf403Count: 0,
    sessionExpiredCount: 0,
    captchaAttempts: 0,
    captchaSuccess: 0
  };

  const activeJobIds = new Set();
  const activeSlots = [];
  const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 1;

  function getFreePort() {
    return new Promise((resolve, reject) => {
      const server = require('net').createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  async function runJob(jobId) {
    let context, page;
    let currentJob = null;
    let browserInstance = null;
    let userDataDir = null;

    try {
      currentJob = await Job.findById(jobId);
      if (!currentJob) return;

      logger.info(
        `🚀 Processing job for: ${currentJob.name} (${currentJob.province} - ${currentJob.tramite})`,
      );

      currentJob.status = "processing";
      currentJob.lastAttempted = new Date();
      await currentJob.save();

      // 2. Setup clean browser session for the job with context-level dynamic proxy rotation and stealth spoofing
      // Generate a dynamic session ID by combining job ID and a random string so retries get fresh IPs
      const randSession = Math.random().toString(36).substring(2, 6);
      const jobSession = `${currentJob._id.toString().substring(currentJob._id.toString().length - 6)}${randSession}`;
      global.currentProxySessionId = jobSession; // Used dynamically by local proxy tunnel in browserManager.js
      let proxyServer = config.PROXY.server;
      let proxyUsernameWithSession = "";
      if (config.PROXY.username) {
        if (proxyServer && proxyServer.includes("gw.dataimpulse.com")) {
          // Resolve gw.dataimpulse.com to its IP using Google/Cloudflare DNS to bypass local router DNS timeouts
          let resolvedHost = "gw.dataimpulse.com";
          try {
            const dns = require("dns").promises;
            const resolver = new dns.Resolver();
            resolver.setServers(["8.8.8.8", "1.1.1.1"]);
            const ips = await resolver.resolve4("gw.dataimpulse.com");
            if (ips && ips.length > 0) {
              resolvedHost = ips[Math.floor(Math.random() * ips.length)];
              logger.info(`[DNS RESOLUTION]: Resolved gw.dataimpulse.com to ${resolvedHost} via Google DNS`);
            }
          } catch (dnsErr) {
            // Hardcoded fallback IPs in case DNS query fails entirely
            const fallbackIps = ["177.54.154.87", "72.46.87.177"];
            resolvedHost = fallbackIps[Math.floor(Math.random() * fallbackIps.length)];
            logger.warn(`[DNS RESOLUTION FAILED]: ${dnsErr.message}. Using fallback IP: ${resolvedHost}`);
          }

          // Parse the target port dynamically from the configuration URL
          let targetPort = 823;
          const portMatch = config.PROXY.server.match(/:(\d+)$/);
          if (portMatch) {
            targetPort = parseInt(portMatch[1], 10);
          }
          proxyServer = `http://${resolvedHost}:${targetPort}`;
          
          // DataImpulse session rotation requires appending sessid to the username
          proxyUsernameWithSession = `${config.PROXY.username};sessid.${jobSession}`;
          logger.info(`[PROXY DYNAMIC SESSION]: Routed via ${resolvedHost}:${targetPort} with Session ID: sessid.${jobSession}`);
        } else if (proxyServer && proxyServer.includes("dataimpulse.com")) {
          proxyUsernameWithSession = `${config.PROXY.username};sessid.${jobSession}`;
        } else if (proxyServer && proxyServer.includes("superproxy.io")) {
          // Bright Data session ID must go directly after the zone parameter, e.g. after -zone-<name>
          const username = config.PROXY.username;
          const zoneMatch = username.match(/(-zone-[a-zA-Z0-9_]+)/);
          if (zoneMatch) {
            const zoneString = zoneMatch[0];
            proxyUsernameWithSession = username.replace(zoneString, `${zoneString}-session-${jobSession}`);
          } else {
            proxyUsernameWithSession = `${username}-session-${jobSession}`;
          }
          logger.info(`[PROXY DYNAMIC SESSION]: Bright Data username formatted to: ${proxyUsernameWithSession}`);
        } else {
          proxyUsernameWithSession = `${config.PROXY.username}_session-${jobSession}`;
        }
      }

      // Pool of viewports to randomize browser fingerprints
      const viewports = [
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
        { width: 1536, height: 864 },
        { width: 1600, height: 900 },
        { width: 1280, height: 800 },
        { width: 1920, height: 1080 }
      ];
      const randomVP = viewports[Math.floor(Math.random() * viewports.length)];
      const contextOptions = {
        viewport: null, // Let page fit the actual physical window size exactly
        locale: "es-ES",
        timezoneId: "Europe/Madrid",
        geolocation: { latitude: 40.416775, longitude: -3.703790 }, // Madrid coordinates
        permissions: ["geolocation"],
        ignoreHTTPSErrors: true
      };

      // Context proxy is handled by the process-level local tunnel.
      logger.info(`Proxy IP Session dynamically routed on tunnel: sessid.local${jobSession}`);

      // Get free ports dynamically for Chrome and Proxy tunnel
      const chromePort = await getFreePort();
      const proxyPort = await getFreePort();

      // Launch isolated browser
      // Calculate dynamic window position grid based on the active index in queue
        const activeIndex = Math.max(0, activeSlots.indexOf(jobId));
        const windowWidth = 640;
        const windowHeight = 480;
        const cols = 3; // 3 columns grid
        const colIndex = activeIndex % cols;
        const rowIndex = Math.floor(activeIndex / cols);
        const windowX = colIndex * windowWidth;
        const windowY = rowIndex * windowHeight;

        // Launch isolated browser
        const launchResult = await launchBrowser(jobSession, chromePort, proxyPort, windowX, windowY, windowWidth, windowHeight);
      browserInstance = launchResult.browser;
      userDataDir = launchResult.userDataDir;

      context = await browserInstance.newContext(contextOptions);
      activeContexts.set(currentJob._id.toString(), context);
      page = await context.newPage();

      // Hide navigator.webdriver property and CDC/CDP debugger variables to bypass WAF verification checks
      await page.addInitScript(() => {
        try {
          delete Object.getPrototypeOf(navigator).webdriver;
        } catch (e) {}

        try {
          const filterKeys = (keys) => keys.filter(k => typeof k !== 'string' || (!k.includes('cdc_') && !k.includes('playwright')));
          
          const origGetOwnPropertyNames = Object.getOwnPropertyNames;
          Object.getOwnPropertyNames = function(obj) {
            const names = origGetOwnPropertyNames.apply(this, arguments);
            if (obj === window) {
              return filterKeys(names);
            }
            return names;
          };
          
          const origKeys = Object.keys;
          Object.keys = function(obj) {
            const keys = origKeys.apply(this, arguments);
            if (obj === window) {
              return filterKeys(keys);
            }
            return keys;
          };
          
          const origReflectKeys = Reflect.ownKeys;
          Reflect.ownKeys = function(target) {
            const keys = origReflectKeys.apply(this, arguments);
            if (target === window) {
              return filterKeys(keys);
            }
            return keys;
          };
        } catch (e) {}
      });

      // Listen to browser console and runtime errors for debugging
      page.on("pageerror", (err) => {
        logger.error(`[BROWSER PAGE ERROR]: ${err.message}`);
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          logger.warn(`[BROWSER CONSOLE ERROR]: ${msg.text()}`);
        }
      });

      // Verify public IP using a block-proof service routed through the proxy
      try {
        const ipCheck = await page.request.get("https://api.ipify.org?format=json", { timeout: 12000 });
        if (ipCheck.status() === 200) {
          const ipJson = await ipCheck.json();
          logger.info(`🌐 [IP ROUTING CHECK]: Active Public IP is: ${ipJson.ip}`);
        } else {
          logger.warn(`🌐 [IP ROUTING CHECK]: Status returned ${ipCheck.status()}`);
        }
      } catch (ipErr) {
        logger.warn(`🌐 [IP ROUTING CHECK FAILED]: Could not verify routing IP: ${ipErr.message}`);
      }



      // 4. Map DB fields to what icpBookingFlow expects
      let docType = currentJob.docType;
      let docNumber = "";

      if (docType === "PASAPORTE" && currentJob.passportNumber) {
        docNumber = currentJob.passportNumber;
      } else if (docType === "N.I.E." && currentJob.nieNumber) {
        docNumber = currentJob.nieNumber;
      } else if (docType === "D.N.I." && currentJob.dniNumber) {
        docNumber = currentJob.dniNumber;
      } else {
        // Fallback for backwards compatibility or missing values
        if (currentJob.passportNumber) {
          docType = "PASAPORTE";
          docNumber = currentJob.passportNumber;
        } else if (currentJob.nieNumber) {
          docType = "N.I.E.";
          docNumber = currentJob.nieNumber;
        } else if (currentJob.dniNumber) {
          docType = "D.N.I.";
          docNumber = currentJob.dniNumber;
        }
      }

      const user = {
        province: currentJob.province,
        tramite: currentJob.tramite,
        docType: docType,
        passport: docNumber,
        passportNumber: currentJob.passportNumber,
        nieNumber: currentJob.nieNumber,
        dniNumber: currentJob.dniNumber,
        name: currentJob.name,
        oficina: currentJob.oficina,
        birthYear: currentJob.birthYear,
        nationality: currentJob.nationality,
        expiryDate: currentJob.expiryDate,
        phone: currentJob.phone || "600000000",
        email: currentJob.email || "test@test.com",
        preferredDate: currentJob.preferredDate,
        preferredTime: currentJob.preferredTime,
        jobId: currentJob._id.toString(),
      };

      // Ensure the browser navigates to the starting URL before starting the flow
      logger.info(`Loading portal: ${config.MONITOR_URL}`);
      let loaded = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await page.goto(config.MONITOR_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          loaded = true;
          break;
        } catch (gotoErr) {
          logger.warn(`⚠️ Failed to load portal (Attempt ${attempt}/3): ${gotoErr.message}`);
          if (attempt === 3) throw gotoErr;
          await page.waitForTimeout(3000);
        }
      }

      // 5. Run the automation flow
      const flowResult = await icpBookingFlow(page, user);

      if (flowResult && flowResult.success) {
        logger.info(`🎉 Job completed successfully for ${currentJob.name}`);
        global.automationStats.successRuns++;
        global.adaptivePollDelay = Math.max((global.adaptivePollDelay || 5000) - 2000, 5000);

        currentJob.status = "completed";
        currentJob.failureReason = "Appointment booked successfully!";
        await currentJob.save();
      } else {
        logger.info(
          `❌ Job failed (No appointments or flow error) for ${currentJob.name}`,
        );
        global.automationStats.failedRuns++;

        // Keep job status as pending to run metrics collection loop continuously, unless it was stopped/failed manually
        const freshJobSuccess = await Job.findById(currentJob._id).catch(() => null);
        if (freshJobSuccess && freshJobSuccess.status === "failed") {
          logger.info(`Job ${currentJob.name} was stopped/failed during execution. Leaving status as failed.`);
        } else {
          currentJob.status = "pending";
          currentJob.failureReason = "Resetting automatically for diagnostic metrics collection";
          await currentJob.save();
        }
      }
      global.automationStats.totalRuns++;

      // Write stats report to markdown
      saveMetricsReport();
    } catch (err) {
      if (currentJob) {
        logger.error(`Orchestrator Loop Error: ${err.message}`);
        global.automationStats.totalRuns++;
        global.automationStats.failedRuns++;

        const errMsg = err.message || "";
        const isWafOrAssetBlock = 
          errMsg.includes("403") || 
          errMsg.includes("Blocked") || 
          errMsg.includes("Forbidden") || 
          errMsg.includes("429") || 
          errMsg.toLowerCase().includes("too many requests") ||
          errMsg.toLowerCase().includes("envia is not defined") ||
          errMsg.toLowerCase().includes("jquery is not defined") ||
          errMsg.toLowerCase().includes("is not defined") ||
          errMsg.toLowerCase().includes("mime type") ||
          errMsg.toLowerCase().includes("err_failed") ||
          errMsg.toLowerCase().includes("timed_out") ||
          errMsg.toLowerCase().includes("rate limit");

        if (isWafOrAssetBlock) {
          global.automationStats.waf403Count++;
          global.adaptivePollDelay = Math.min((global.adaptivePollDelay || 5000) * 2, 20000);
          logger.warn(`[POLLING COOLDOWN]: WAF, Rate Limit or Asset Block detected. Increasing polling interval to ${global.adaptivePollDelay}ms...`);
        }
        if (errMsg.toLowerCase().includes("caducado") || errMsg.toLowerCase().includes("expired")) {
          global.automationStats.sessionExpiredCount++;
        }



        // Always reset to pending to ensure continuous execution of the metrics loop, unless manually stopped/failed
        const freshJobError = await Job.findById(currentJob._id).catch(() => null);
        if (freshJobError && freshJobError.status === "failed") {
          logger.info(`Job ${currentJob.name} was stopped/failed manually. Leaving status as failed.`);
        } else {
          currentJob.status = "pending";
          currentJob.failureReason = `Continuous Run Error: ${err.message}`;
          await currentJob.save().catch(() => {});
        }

        // Write stats report to markdown
        saveMetricsReport();
      }
    } finally {
        const slotIndex = activeSlots.indexOf(jobId);
        if (slotIndex !== -1) {
          activeSlots[slotIndex] = null;
        }
      if (currentJob) {
        activeContexts.delete(currentJob._id.toString());
      }
      // Always cleanup the context to prevent memory leaks and ensure WAF reset
      if (context) {
        await context.close().catch(() => {});
      }
      if (browserInstance) {
        await browserInstance.close().catch(() => {});
      }

      // Wait a bit for Chrome to release file locks on Windows, then clean up profile directory
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (userDataDir && require('fs').existsSync(userDataDir)) {
        try {
          require('fs').rmSync(userDataDir, { recursive: true, force: true });
          logger.info(`Cleaned up temp user data directory: ${userDataDir}`);
        } catch (rmErr) {
          logger.warn(`Failed to clean up temp user data directory ${userDataDir}: ${rmErr.message}`);
        }
      }

      // Add a cooling period of 5-10 seconds before resolving the job queue slot to let the WAF fingerprint cool down
      const coolDelay = Math.floor(Math.random() * 5000) + 5000;
      logger.info(`[COOLDOWN]: Cooling down for ${coolDelay}ms to reset IP fingerprint...`);
      await new Promise((resolve) => setTimeout(resolve, coolDelay));

      activeJobIds.delete(jobId);
    }
  }

  while (true) {
    try {
      // Check if we have slots to run more concurrent jobs
      if (activeJobIds.size < MAX_CONCURRENT_JOBS) {
        const pendingJobs = await Job.find({
          status: "pending",
          _id: { $nin: Array.from(activeJobIds).map(id => new mongoose.Types.ObjectId(id)) }
        }).sort({ createdAt: 1 }).limit(MAX_CONCURRENT_JOBS - activeJobIds.size);

        for (const job of pendingJobs) {
          const jobId = job._id.toString();
          activeJobIds.add(jobId);
            
            let slotIndex = activeSlots.indexOf(null);
            if (slotIndex === -1) {
              slotIndex = activeSlots.length;
              activeSlots.push(jobId);
            } else {
              activeSlots[slotIndex] = jobId;
            }
            
            // Launch job asynchronously
            runJob(jobId);
        }
      }

      // Wait dynamic adaptive time before checking database queue again
      await new Promise((resolve) => setTimeout(resolve, global.adaptivePollDelay || 5000));
    } catch (loopErr) {
      logger.error(`Main loop iteration error: ${loopErr.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
})();

function saveMetricsReport() {
  const fs = require('fs');
  const path = require('path');
  const s = global.automationStats;
  const accuracy = s.captchaAttempts > 0 ? Math.round((s.captchaSuccess / s.captchaAttempts) * 100) : 0;
  const report = `# Automation Run Statistics

- **Total Runs:** ${s.totalRuns}
- **Successful Runs:** ${s.successRuns}
- **Failed Runs:** ${s.failedRuns}
- **WAF 403 blocks:** ${s.waf403Count}
- **Session Expired redirects:** ${s.sessionExpiredCount}
- **CAPTCHA Attempts:** ${s.captchaAttempts}
- **CAPTCHA Solved successfully:** ${s.captchaSuccess}
- **CAPTCHA Accuracy Rate:** ${accuracy}%

*Last updated: ${new Date().toISOString()}*
`;
  const logDir = path.join(__dirname, '../logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  fs.writeFileSync(path.join(logDir, 'run_stats.md'), report, 'utf8');
}
