const logger = require("../logs/logger");

/**
 * Send a professional markdown-formatted notification message via Telegram Bot.
 * @param {string} message - Markdown formatted string.
 */
async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    logger.warn("[Telegram Notification] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in environment variables. Notification skipped.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[Telegram Notification] Failed to send message: ${response.status} - ${errText}`);
    } else {
      logger.info("[Telegram Notification] Professional notification sent successfully to Telegram!");
    }
  } catch (err) {
    logger.error(`[Telegram Notification] Network/Server error while sending message: ${err.message}`);
  }
}

module.exports = { sendTelegramNotification };
