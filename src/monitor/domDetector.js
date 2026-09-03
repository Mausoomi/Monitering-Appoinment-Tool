const logger = require('../logs/logger');

async function domDetector(page) {

    try {

        if (page.isClosed()) {
            logger.info('No Slot Found (page closed)');
            return false;
        }

        // Example selector
        const secureText = await page.locator('h1, h2, h3, h4').allTextContents();

        logger.info(`DOM Content: ${secureText}`);

        // Slot simulation
        if (secureText.join(' ').includes('Secure')) {

            logger.info(' SLOT DETECTED USING DOM');

            return true;

        }

        logger.info('No Slot Found');

        return false;

    } catch (err) {

        logger.error(`DOM Detection Error: ${err.message}`);

        return false;

    }

}

module.exports = domDetector;