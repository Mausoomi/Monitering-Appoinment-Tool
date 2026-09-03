const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const latencyLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => {
      return `${timestamp} [LATENCY]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'latency.log'),
      level: 'info'
    }),
    new winston.transports.Console()
  ]
});

function logLatency(message) {
  latencyLogger.info(message);
}

module.exports = logLatency;
