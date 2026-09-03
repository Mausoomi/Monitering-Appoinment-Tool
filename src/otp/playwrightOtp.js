const config = require("../config/config");
const logger = require("../logs/logger");
const { createOtpMetrics } = require("./otpMetrics");
const { sendOtpToMobile } = require("./otpService");

/**
 * Read mobile from form → send OTP on Telegram → fill OTP on page.
 *
 * @param {import('playwright').Page} page
 * @param {{ mobileSelector?: string, otpSelector?: string, submitSelector?: string }} [opts]
 */
async function runOtpStepForMobile(page, opts = {}) {
  const mobileSelector = opts.mobileSelector || config.MOBILE_INPUT_SELECTOR;
  const otpSelector = opts.otpSelector || config.OTP_INPUT_SELECTOR;
  const submitSelector = opts.submitSelector ?? config.OTP_SUBMIT_SELECTOR;

  const metrics = createOtpMetrics();

  await page
    .locator(mobileSelector)
    .waitFor({ state: "visible", timeout: 30000 });
  const mobile = (await page.locator(mobileSelector).inputValue()).trim();

  if (!mobile) {
    throw new Error("Mobile number is required in the booking form");
  }

  logger.info(`[OTP] Mobile from form: ${mobile}`);

  metrics.mark("sent");
  metrics.mark("telegram_start");
  const { code } = await sendOtpToMobile(mobile);
  metrics.mark("telegram_end");

  metrics.mark("ui_fill_start");
  await page.locator(otpSelector).waitFor({ state: "visible", timeout: 30000 });
  await page.locator(otpSelector).fill(code);
  metrics.mark("ui_fill_end");
  metrics.mark("filled");
  logger.info("[OTP] OTP filled on booking form.");

  if (submitSelector) {
    await page.locator(submitSelector).click();
    logger.info("[OTP] OTP verify submitted.");
  }

  metrics.logSummary(mobile);
  return { mobile, code };
}

module.exports = { runOtpStepForMobile };
