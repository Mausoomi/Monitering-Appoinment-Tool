
// require("dotenv").config();

// const DEFAULT_MONITOR_URL =
//   "https://practice.expandtesting.com/secure";

// const DEFAULT_BOOKING_FORM_URL =
//   "https://demoqa.com/automation-practice-form";

// const rawMax = process.env.BOOKING_ON_SLOT_MAX;

// const parsedMax =
//   rawMax === undefined || rawMax === ""
//     ? 1
//     : Math.max(0, parseInt(rawMax, 10) || 0);

// module.exports = {

//   // =========================
//   // URLS
//   // =========================

//   MONITOR_URL:
//     (process.env.MONITOR_URL || "").trim() ||
//     DEFAULT_MONITOR_URL,

//   BOOKING_FORM_URL:
//     (
//       process.env.BOOKING_FORM_URL ||
//       process.env.BOOKING_DEMO_ORIGIN ||
//       ""
//     ).trim() || DEFAULT_BOOKING_FORM_URL,

//   // =========================
//   // SESSION
//   // =========================

//   SESSION_PATH:
//     (process.env.SESSION_PATH || "").trim() ||
//     "./storage/sessions/session.json",

//   // =========================
//   // MONITORING
//   // =========================

//   HEADLESS: false,

//   CHECK_INTERVAL: 3000,

//   BOOKING_ON_SLOT_MAX: parsedMax,

//   // =========================
//   // TELEGRAM / OTP
//   // =========================

//   TELEGRAM_BOT_TOKEN:
//     (process.env.TELEGRAM_BOT_TOKEN || "").trim(),

//   TELEGRAM_CHAT_ID:
//     (
//       process.env.TELEGRAM_CHAT_ID ||
//       process.env.TELEGRAM_DEFAULT_CHAT_ID ||
//       ""
//     ).trim(),

//   OTP_LENGTH: Math.min(
//     8,
//     Math.max(
//       4,
//       parseInt(process.env.OTP_LENGTH || "6", 10) || 6
//     )
//   ),

//   // =========================
//   // FORM SELECTORS
//   // =========================

//   MOBILE_INPUT_SELECTOR: "#userNumber",

//   OTP_INPUT_SELECTOR:
//     (process.env.OTP_INPUT_SELECTOR || "#otp").trim(),

//   OTP_SUBMIT_SELECTOR:
//     (process.env.OTP_SUBMIT_SELECTOR || "").trim(),

//   // =========================
//   // PROXY CONFIG 🔥
//   // =========================

//   PROXY: {

//     server:
//       (process.env.PROXY_SERVER || "").trim(),

//     username:
//       (process.env.PROXY_USERNAME || "").trim(),

//     password:
//       (process.env.PROXY_PASSWORD || "").trim(),

//   }

// };


require("dotenv").config();

const DEFAULT_MONITOR_URL =
  "https://icp.administracionelectronica.gob.es/icpplus/";

const rawMax =
  process.env.BOOKING_ON_SLOT_MAX;

const parsedMax =
  rawMax === undefined || rawMax === ""
    ? 1
    : Math.max(
        0,
        parseInt(rawMax, 10) || 0
      );

module.exports = {

  // =========================
  // TARGET PORTAL
  // =========================

  MONITOR_URL:
    (process.env.MONITOR_URL || "").trim() ||
    DEFAULT_MONITOR_URL,

  // =========================
  // SESSION CONFIG
  // =========================

  SESSION_PATH:
    (process.env.SESSION_PATH || "").trim() ||
    "./storage/sessions/session.json",

  // =========================
  // MONITORING CONFIG
  // =========================

  HEADLESS:
    process.env.HEADLESS === "true",

  CHECK_INTERVAL:
    parseInt(
      process.env.CHECK_INTERVAL || "3000",
      10
    ),

  BOOKING_ON_SLOT_MAX:
    parsedMax,

  // =========================
  // OTP / TELEGRAM
  // =========================

  TELEGRAM_BOT_TOKEN:
    (
      process.env.TELEGRAM_BOT_TOKEN || ""
    ).trim(),

  TELEGRAM_CHAT_ID:
    (
      process.env.TELEGRAM_CHAT_ID ||
      process.env.TELEGRAM_DEFAULT_CHAT_ID ||
      ""
    ).trim(),

  OTP_LENGTH: Math.min(
    8,
    Math.max(
      4,
      parseInt(
        process.env.OTP_LENGTH || "6",
        10
      ) || 6
    )
  ),

  // =========================
  // PROXY CONFIG
  // =========================

  PROXY: {

    server:
      (
        process.env.PROXY_SERVER || ""
      ).trim(),

    username:
      (
        process.env.PROXY_USERNAME || ""
      ).trim(),

    password:
      (
        process.env.PROXY_PASSWORD || ""
      ).trim(),

  }

};