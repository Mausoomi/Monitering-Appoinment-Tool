const logger = require('../logs/logger');

async function sessionValidator(page) {

    try {

        const currentUrl = page.url();

        logger.info(`Current URL: ${currentUrl}`);

        // Example login detection
        if (
            currentUrl.includes('login')
        ) {

            logger.error('❌ Session Expired');

            return false;

        }

        logger.info('✅ Session Active');

        return true;

    } catch (err) {

        logger.error(
          `Session Validation Error: ${err.message}`
        );

        return false;

    }

}

module.exports = sessionValidator;