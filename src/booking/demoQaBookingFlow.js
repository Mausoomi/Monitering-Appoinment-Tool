const logger = require("../logs/logger");
const config = require("../config/config");
const bookingData = require("./bookingData");
const { ensureOtpFieldOnPage } = require("./ensureOtpField");
const { runBookingOtpStep } = require("./bookingOtpStep");
const { startTimer, endTimer } = require("../latency/latencyTracker");

/**
 * DemoQA practice form — built-in mobile (#userNumber), then Telegram OTP, then submit.
 * https://demoqa.com/automation-practice-form
 */
async function runDemoQaBookingFlow(
  page,
  triggerStartTime,
  data = bookingData,
) {
  const flowStartTime = startTimer();
  logger.info("[E2E] Booking flow started");

  if (triggerStartTime) {
    const triggerLatency = endTimer(triggerStartTime);
    if (triggerLatency > 200) {
      logger.warn(
        `[Latency Validation] Trigger took too long: ${triggerLatency}ms`,
      );
    } else {
      logger.info(
        `[Latency Validation] Trigger latency OK: ${triggerLatency}ms`,
      );
    }
  }

  const { formUrl, passenger } = data;

  // 1. Page Load Step
  try {
    logger.info("[Booking] [E2E] Open DemoQA registration form");
    const loadStartTime = startTimer();
    await page.goto(formUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    logger.info(`[Metrics] Page load took ${endTimer(loadStartTime)}ms`);
  } catch (err) {
    logger.error(`[Booking] Page Load Error: ${err.message}`);
    return { ok: false, errorType: "PAGE_LOAD_ERROR", error: err };
  }

  // 2. Form Fill Step
  try {
    logger.info("[Booking] [E2E] Fill form (includes mobile)");
    const fillStartTime = startTimer();
    await page.locator("#firstName").fill(passenger.firstName);
    await page.locator("#lastName").fill(passenger.lastName);
    await page.locator("#userEmail").fill(passenger.email);
    await page
      .locator(`#gender-radio-${passenger.genderRadio}`)
      .click({ force: true });
    await page.locator(config.MOBILE_INPUT_SELECTOR).fill(passenger.mobile);
    await page.locator("#currentAddress").fill(passenger.address);
    logger.info(`[Metrics] Form fill took ${endTimer(fillStartTime)}ms`);
  } catch (err) {
    logger.error(`[Booking] Form Fill Error: ${err.message}`);
    return { ok: false, errorType: "FORM_FILL_ERROR", error: err };
  }

  // 3. OTP Step
  try {
    await ensureOtpFieldOnPage(page, config.OTP_INPUT_SELECTOR);

    if (config.TELEGRAM_BOT_TOKEN) {
      await runBookingOtpStep(page);
    } else {
      logger.info("[Booking] Skipping OTP (set TELEGRAM_BOT_TOKEN in .env)");
    }
  } catch (err) {
    logger.error(`[Booking] OTP Fetch Error: ${err.message}`);
    return { ok: false, errorType: "OTP_ERROR", error: err };
  }

  // 4. Form Submit Step
  try {
    logger.info("[Booking] [E2E] Submit form");
    const submitStartTime = startTimer();
    await page.locator("#submit").click();
    await page
      .locator(".modal-content")
      .waitFor({ state: "visible", timeout: 30000 });
    logger.info(
      `[Metrics] Form submission and modal wait took ${endTimer(submitStartTime)}ms`,
    );

    const modalText = await page.locator(".modal-content").textContent();
    logger.info(`[Booking] Done. ${modalText?.slice(0, 80)}…`);
  } catch (err) {
    logger.error(`[Booking] Form Submit Error: ${err.message}`);
    return { ok: false, errorType: "FORM_SUBMIT_ERROR", error: err };
  }

  const totalLatency = endTimer(flowStartTime);
  logger.info(`[E2E] Booking flow fully complete in ${totalLatency}ms`);

  return { ok: true, submitted: true };
}

module.exports = { runDemoQaBookingFlow };
