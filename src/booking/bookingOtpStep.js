const config = require("../config/config");
const logger = require("../logs/logger");
const { runOtpStepForMobile } = require("../otp/playwrightOtp");

/**
 * After mobile is on the page: send OTP to that number's Telegram chat and fill form.
 */
async function runBookingOtpStep(page) {
  if (!config.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for OTP");
  }

  logger.info("[Booking] OTP step (mobile → Telegram → form)…");
  await runOtpStepForMobile(page);
  logger.info("[Booking] OTP step done.");
}

module.exports = { runBookingOtpStep };
