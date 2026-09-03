const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => {
        return `${timestamp} [${level.toUpperCase()}]: ${message}`;
      }
    )
  ),
  transports: [
    // ACTIVITY LOGS
    new winston.transports.File({
      filename: path.join(logDir, 'activity.log'),
      level: 'info'
    }),
    // ERROR LOGS
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error'
    }),
    // Console
    new winston.transports.Console()
  ]
});

module.exports = logger;