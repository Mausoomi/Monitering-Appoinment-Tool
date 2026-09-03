const logger = require("../logs/logger");

function createOtpMetrics() {
  const marks = {};

  return {
    mark(name) {
      marks[name] = Date.now();
    },
    logSummary(mobile) {
      const { sent, filled, telegram_start, telegram_end, ui_fill_start, ui_fill_end } = marks;
      if (!sent) return;
      
      const parts = [`[OTP Metrics] mobile=${mobile}`];
      
      if (filled) {
        parts.push(`total_send_to_fill_ms=${filled - sent}`);
      }
      
      if (telegram_start && telegram_end) {
        parts.push(`telegram_api_ms=${telegram_end - telegram_start}`);
      }
      
      if (ui_fill_start && ui_fill_end) {
        parts.push(`ui_fill_ms=${ui_fill_end - ui_fill_start}`);
      }

      logger.info(parts.join(" "));
    },
  };
}

module.exports = { createOtpMetrics };
