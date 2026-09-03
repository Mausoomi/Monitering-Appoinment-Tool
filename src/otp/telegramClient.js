const { startTimer, endTimer } = require("../latency/latencyTracker");
const logger = require("../logs/logger");

/**
 * Telegram Bot API — send messages.
 */

/**
 * @param {string} token
 * @param {string|number} chatId
 * @param {string} text
 */
async function sendMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  const startTime = startTimer();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
  const latency = endTimer(startTime);

  const body = await res.json();

  if (!body.ok) {
    throw new Error(body.description || "Telegram sendMessage failed");
  }

  logger.info(`[Metrics] Telegram API call took ${latency}ms`);
  return body.result;
}

module.exports = { sendMessage };
