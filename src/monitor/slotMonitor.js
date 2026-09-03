const logger = require('../logs/logger');

async function slotMonitor(page, domDetector) {

    try {

        logger.info(' Running Slot Monitor...');

        // DOM Fallback
        const domResult = await domDetector(page);

        if (domResult) {

            logger.info(' SLOT DETECTED');

            return true;

        }

        logger.info(' No Slot Available');

        return false;

    } catch (err) {

        logger.error(`Slot Monitor Error: ${err.message}`);

        return false;

    }

}

module.exports = slotMonitor;