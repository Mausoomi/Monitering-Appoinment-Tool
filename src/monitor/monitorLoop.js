const delay = require("../utils/delay");
const logger = require("../logs/logger");
const config = require("../config/config");
const { runDemoQaBookingFlow } = require("../booking/demoQaBookingFlow");
const { startTimer } = require("../latency/latencyTracker");
const sessionValidator = require('../sessions/sessionValidator');
const recoverSession = require('../sessions/recoverSession');
let bookingRunsCompleted = 0;

async function monitorLoop(page, slotMonitor, domDetector) {
  let bookingPage = null;

  // --- API Interception Feasibility Validation ---
  page.on('response', async (response) => {
    try {
      const contentType = response.headers()['content-type'];
      if (contentType && contentType.includes('application/json')) {
        const url = response.url();
        const data = await response.text();
        const lowerData = data.toLowerCase();

        if (lowerData.includes('available') || lowerData.includes('slots') || lowerData.includes('true')) {
          logger.info(`[API Interception Validation] Potential slot data at URL: ${url}`);
          logger.info(`[API Interception Validation] Payload snippet: ${data.substring(0, 150).replace(/\n/g, ' ')}`);
        }
      }
    } catch (e) {
      // Ignore errors (e.g. response body already consumed or page closed)
    }
  });

  while (true) {
    try {
      if (page.isClosed()) {
        logger.error("Monitor page closed — stop loop (restart app).");
        break;
      }

      // Pre-create booking page to reduce latency after slot detection
      if (!bookingPage || bookingPage.isClosed()) {
        bookingPage = await page.context().newPage();
      }

      logger.info(" Monitoring Cycle Started");

      const slotFound = await slotMonitor(page, domDetector);

      if (slotFound && config.BOOKING_ON_SLOT_MAX > 0) {
        const triggerStartTime = startTimer(); // Track exact trigger time

        if (bookingRunsCompleted < config.BOOKING_ON_SLOT_MAX) {
          logger.info(
            ` Slot detected — starting booking (${bookingRunsCompleted + 1}/${config.BOOKING_ON_SLOT_MAX})…`
          );

          try {
            const result = await runDemoQaBookingFlow(bookingPage, triggerStartTime);
            if (result.ok) {
              bookingRunsCompleted += 1;
              logger.info(" Booking finished OK.");
            } else {
              logger.error(` Booking flow returned error: ${result.errorType} - ${result.error?.message || result.error}`);
            }
          } catch (bookingErr) {
            logger.error(` Booking crashed unexpectedly: ${bookingErr.message}`);
          } finally {
            // close and clear page so a fresh one is created next cycle
            if (bookingPage && !bookingPage.isClosed()) {
              await bookingPage.close().catch(() => { });
            }
            bookingPage = null;
          }
        } else {
          logger.info(
            " Slot still detected — auto-booking limit reached for this session (BOOKING_ON_SLOT_MAX)."
          );
        }
      }

      logger.info(" Monitoring Cycle Completed");
    } catch (err) {
      logger.error(`Monitoring Error: ${err.message}`);
    }
    const validSession =
      await sessionValidator(page);

    if (!validSession) {

      logger.error(
        "Session invalid - recovery required"
      );

      const recovered =
        await recoverSession(
          page.context().browser()
        );

      if (recovered) {

        page = recovered.page;

        logger.info(
          'Monitoring Resumed'
        );

      } else {

        logger.error(
          'Recovery Completely Failed'
        );

        await delay(10000);

      }

      continue;
    }
    await delay(5000);
  }
}

module.exports = monitorLoop;
