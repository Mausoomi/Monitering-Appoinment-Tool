const logger = require('../logs/logger');

const logLatency =
  require('../logs/latencyLogger');

async function xhrDetector(response) {

    try {

        const url = response.url();

        const contentType =
          response.headers()['content-type'];

        // Only JSON responses
      if (
  contentType &&
  contentType.includes('application/json')
) {

    logger.info(`XHR URL: ${url}`);

    const data =
      await response.text();

            

            const lowerData =
              data.toLowerCase();

            // 🔥 POSSIBLE SLOT SIGNALS
            const keywords = [

                'available',
                'slot',
                'appointment',
                'calendar',
                'date',
                'booking'

            ];

            const matched =
              keywords.some(keyword =>
                lowerData.includes(keyword)
              );

            if (matched) {

                logger.info(
                  '========= DETECTION ========='
                );

                logger.info(
                  `Potential Slot API: ${url}`
                );

                logger.info(
                  `Payload Snippet: ${
                    data.substring(0, 300)
                  }`
                );

                logger.info(
                  'Potential booking-related response detected'
                );

                logger.info(
                  '============================='
                );

                // 🔥 LATENCY EVIDENCE
                logLatency(
                  `Detection API Hit: ${url}`
                );

                return true;

            }

        }

        return false;

    } catch(err) {

        logger.error(
          `XHR Detection Error: ${err.message}`
        );

        return false;

    }

}

module.exports = xhrDetector;