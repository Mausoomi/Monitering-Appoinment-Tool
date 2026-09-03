/**
 * Preloaded user data for DemoQA practice form (booking demo).
 */

const config = require("../config/config");

module.exports = {
  formUrl: config.BOOKING_FORM_URL,

  passenger: {
    firstName: "Test",
    lastName: "User",
    email: "test.user@example.com",
    genderRadio: 1,
    mobile: "3524598487",
    address: "123 Automation Street",
  },
};
