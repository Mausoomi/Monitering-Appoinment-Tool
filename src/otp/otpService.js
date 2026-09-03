const config = require("../config/config");
const logger = require("../logs/logger");
const { sendMessage } = require("./telegramClient");
const { resolveChatIdForMobile, normalizePhone } = require("./phoneChatMap");

function generateOtp() {
  const len = config.OTP_LENGTH;
  const max = 10 ** len;
  const num = Math.floor(Math.random() * max);
  return String(num).padStart(len, "0");
}

/**
 * Send OTP to the Telegram chat linked to this mobile (not SMS).
 * OTP is sent to TELEGRAM_CHAT_ID; mobile is taken from the booking form.
 *
 * @param {string} mobile
 * @param {string} [code]
 * @returns {Promise<{ code: string, chatId: string, sentAt: number }>}
 */
async function sendOtpToMobile(mobile, code = generateOtp()) {
  const token = config.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");
  }

  const chatId = resolveChatIdForMobile(mobile);
  const phoneDisplay = normalizePhone(mobile);
  const text =
    `Booking OTP for mobile ${phoneDisplay}: ${code}\n\n` +
    `This number was entered on the booking form. Enter the code to continue.`;

  const sentAt = Date.now();
  logger.info(`[OTP] Sending OTP to Telegram chat ${chatId} (mobile ${phoneDisplay})…`);

  await sendMessage(token, chatId, text);

  logger.info("[OTP] OTP sent on Telegram.");
  return { code, chatId, sentAt };
}

module.exports = { generateOtp, sendOtpToMobile };
