/**
 * Standalone booking test (DemoQA form + optional Telegram OTP).
 * npm run booking:test
 */
const launchBrowser = require("../browser/browserManager");
const logger = require("../logs/logger");
const { runDemoQaBookingFlow } = require("./demoQaBookingFlow");

(async () => {
  logger.info("[ControlledBookingTest] Starting…");
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await runDemoQaBookingFlow(page);
    logger.info("[ControlledBookingTest] PASSED.");
  } catch (err) {
    logger.error(`[ControlledBookingTest] FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
