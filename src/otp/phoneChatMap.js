const config = require("../config/config");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Telegram chat for OTP delivery. Mobile is read from the booking form only.
 */
function resolveChatIdForMobile(mobile) {
  const key = normalizePhone(mobile);
  if (!key) {
    throw new Error("Mobile number is empty in the booking form");
  }

  if (config.TELEGRAM_CHAT_ID) {
    return String(config.TELEGRAM_CHAT_ID);
  }

  throw new Error(
    "TELEGRAM_CHAT_ID is not set in .env — add your Telegram chat id"
  );
}

module.exports = { normalizePhone, resolveChatIdForMobile };
