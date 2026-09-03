const logger = require('../logs/logger');

const config = require('../config/config');

async function recoverSession(browser) {

    try {

        logger.info(
          '♻ Attempting Session Recovery...'
        );

        // Create fresh context
        const context =
          await browser.newContext({

            storageState:
              config.SESSION_PATH

        });

        const page =
          await context.newPage();

        await page.goto(
          config.MONITOR_URL,
          {
            waitUntil:'domcontentloaded',
            timeout:60000
          }
        );

        logger.info(
          '✅ Session Recovery Successful'
        );

        return {
          context,
          page
        };

    } catch(err) {

        logger.error(
          `Recovery Failed: ${err.message}`
        );

        return null;

    }

}

module.exports = recoverSession;