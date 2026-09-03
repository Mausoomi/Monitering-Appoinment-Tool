/**
 * Sites with mobile but no OTP field — inject OTP input before verify/submit.
 */

async function ensureOtpFieldOnPage(page, selector = "#otp") {
  const exists = await page.locator(selector).count();
  if (exists > 0) return;

  await page.evaluate((sel) => {
    if (document.querySelector(sel)) return;
    const form = document.querySelector("form") || document.body;
    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";
    const label = document.createElement("label");
    label.htmlFor = "otp";
    label.textContent = "OTP (from Telegram)";
    const input = document.createElement("input");
    input.type = "text";
    input.id = "otp";
    input.name = "otp";
    input.placeholder = "Enter OTP";
    wrap.appendChild(label);
    wrap.appendChild(input);
    const submit = form.querySelector("#submit");
    if (submit && submit.parentNode) {
      submit.parentNode.insertBefore(wrap, submit);
    } else {
      form.appendChild(wrap);
    }
  }, selector);
}

module.exports = { ensureOtpFieldOnPage };
