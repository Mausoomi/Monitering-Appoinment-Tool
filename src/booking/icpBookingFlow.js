const logger = require("../logs/logger");
const { createWorker } = require("tesseract.js");
const Job = require("../db/models/Job");
const fs = require("fs");
const path = require("path");

// =====================================
// FORENSICS DIAGNOSTIC LOGGING HOOK
// =====================================
async function logStateBeforePost(page, postName) {
  // Disabled in production to prevent disk writes and screenshots
}

// =====================================
// WAF & RATE LIMIT CHECKER
// =====================================

async function checkPageBlockStatus(page) {
  try {
    const status = await page.evaluate(() => {
      if (!document.body) return { blank: true, blocked: false };
      const text = document.body.innerText.trim();
      const title = document.title ? document.title.trim() : "";
      
      const isBlocked = 
        text.includes("403 Forbidden") ||
        text.includes("permission to access") ||
        text.includes("error en el sistema") ||
        text.includes("429 Too Many Requests") ||
        text.includes("500 Internal Server Error") ||
        text.toLowerCase().includes("too many requests") ||
        text.toLowerCase().includes("internal server error") ||
        text.toLowerCase().includes("sesion ha caducado") ||
        text.toLowerCase().includes("sesión ha caducado") ||
        text.toLowerCase().includes("session has expired") ||
        text.toLowerCase().includes("requested url was rejected") ||
        text.toLowerCase().includes("support id") ||
        text.toLowerCase().includes("consult with your administrator") ||
        title.includes("403") ||
        title.includes("429") ||
        title.includes("500") ||
        title.toLowerCase().includes("too many requests") ||
        title.toLowerCase().includes("internal server error");
        
      return {
        blank: text === "",
        blocked: isBlocked
      };
    });
    
    if (status.blocked) {
      throw new Error("WAF Blocked/Server Error (403/429/500). Session corrupted, restarting flow.");
    }
    return status.blank;
  } catch (err) {
    if (err.message.includes("Session corrupted")) {
      throw err;
    }
    return true; // Treat eval errors as blank
  }
}

// =====================================
// CLICK FAILURE DIAGNOSTIC TRACKER
// =====================================

async function logClickFailureState(page, buttonName) {
  // Disabled in production to prevent disk writes and screenshots
}

// =====================================
// SAFE RELOAD
// =====================================

async function safeReload(page, ignoreError = false) {
  if (!page || page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }
  logger.info("Reloading page with 30-second timeout...");
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    if (ignoreError) {
      logger.warn(`Silent reload timeout/error ignored: ${err.message}`);
    } else {
      throw err;
    }
  }
}

// =====================================
// SMART WAIT
// =====================================

async function waitForElementReady(page, selector, name = "Element") {
  if (!page || page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }
  logger.info(`Waiting For ${name}`);

  // 15-Second Blank Screen Check
  for (let t = 1; t <= 15; t++) {
    if (page.isClosed()) {
      throw new Error("Target page, context or browser has been closed");
    }
    await page.waitForTimeout(1000);
    const isReady = await page
      .evaluate((sel) => document.querySelectorAll(sel).length > 0, selector)
      .catch(() => false);
    if (isReady) break;

    const isBlank = await checkPageBlockStatus(page);
    if (!isBlank) break; // Page has normal content, proceed to normal wait

    logger.warn(`Blank Screen Timer (${name}): ${t}s...`);
    if (t === 15)
      throw new Error(
        "Screen is completely blank after 15 seconds. Force reloading.",
      );
  }

  if (page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }

  await page.waitForSelector(selector, {
    state: "visible",
    timeout: 20000,
  });

  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);

    if (!el) return false;

    return !el.disabled;
  }, selector);

  logger.info(`${name} Ready`);
}

// =====================================
// SMART DROPDOWN WAIT
// =====================================

async function waitForDropdownReady(page, selector, name = "Dropdown") {
  if (!page || page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }
  logger.info(`Waiting For ${name}`);

  // 15-Second Blank Screen Check
  for (let t = 1; t <= 15; t++) {
    if (page.isClosed()) {
      throw new Error("Target page, context or browser has been closed");
    }
    await page.waitForTimeout(1000);
    const isReady = await page
      .evaluate((sel) => document.querySelectorAll(sel).length > 0, selector)
      .catch(() => false);
    if (isReady) break;

    const isBlank = await checkPageBlockStatus(page);
    if (!isBlank) break; // Page has normal content, proceed to normal wait

    logger.warn(`Blank Screen Timer (${name}): ${t}s...`);
    if (t === 15)
      throw new Error(
        "Screen is completely blank after 15 seconds. Force reloading.",
      );
  }

  if (page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }

  try {
    await page.waitForSelector(selector, {
      state: "visible",
      timeout: 15000,
    });
  } catch (e) {
    throw new Error(`${name} not found (Blank Page) within 15s`);
  }

  if (page.isClosed()) {
    throw new Error("Target page, context or browser has been closed");
  }

  try {
    await page.waitForFunction(
      (sel) => {
        const dropdown = document.querySelector(sel);
        if (!dropdown) return false;
        return dropdown.options.length > 1;
      },
      selector,
      { timeout: 15000 },
    );
  } catch (e) {
    throw new Error(`${name} options not loaded within 15s`);
  }

  logger.info(`${name} Ready`);
}

// =====================================
// COOKIE BANNER DISMISSER
// =====================================

async function handleCookieBanner(page) {
  try {
    await page.evaluate(() => {
      // 1. Click common cookie accept buttons (exclude main form/app buttons)
      const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')).filter(b => {
        const idStr = (b.id || "").toLowerCase();
        const nameStr = (b.name || "").toLowerCase();
        // Exclude main form submit buttons
        if (idStr.includes("btnaceptar") || idStr.includes("btnentrar") || idStr.includes("btnenviar") || idStr.includes("btnsiguiente")) {
          return false;
        }
        if (nameStr.includes("btnaceptar") || nameStr.includes("btnentrar") || nameStr.includes("btnenviar") || nameStr.includes("btnsiguiente")) {
          return false;
        }
        // Exclude buttons inside the main forms
        if (b.closest && (b.closest("form") || b.closest("#form") || b.closest(".form"))) {
          return false;
        }
        return true;
      });
      const acceptBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || b.value || "").toLowerCase().trim();
        return text === "acepto" || text.includes("aceptar cookies") || text === "aceptar" || text === "accept";
      });
      if (acceptBtn) {
        acceptBtn.click();
      }
      
      // 2. Hide any cookie container to prevent it intercepting clicks
      const selectors = [
        '[class*="cookie" i]',
        '[id*="cookie" i]',
        '#cookie',
        '.cookie',
        '[class*="banner" i]',
        '[id*="banner" i]'
      ];
      selectors.forEach(sel => {
        try {
          const elements = document.querySelectorAll(sel);
          elements.forEach(el => {
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
          });
        } catch (e) {}
      });
    });
  } catch (err) {
    // Silent catch
  }
}

// =====================================
// SAFE CLICK
// =====================================

async function safeClick(page, selector, name = "Button", useJS = true) {
  // Call forensics log hook
  await logStateBeforePost(page, name.replace(/\s+/g, "_"));

  await waitForElementReady(page, selector, name);

  // Auto-dismiss/hide cookie banners to prevent interception
  await handleCookieBanner(page);

  // Native scroll to center to avoid Cookie Banner overlap at the bottom
  try {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }
    }, selector);
  } catch (e) {
    // Fallback if evaluate fails
    await page.locator(selector).first().scrollIntoViewIfNeeded();
  }

  // Organic pre-click delay (300ms to 700ms)
  const clickDelay = Math.floor(Math.random() * 400) + 300;
  await page.waitForTimeout(clickDelay);

  logger.info(`Simulating Mouse Hover/Movement before click for ${name}...`);
  try {
    const element = page.locator(selector).first();
    const box = await element.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      const startX = Math.max(0, box.x - 30 + Math.random() * 60);
      const startY = Math.max(0, box.y - 30 + Math.random() * 60);
      await page.mouse.move(startX, startY).catch(() => {});
      
      const targetX = box.x + box.width / 2;
      const targetY = box.y + box.height / 2;
      
      await page.mouse.move(targetX, targetY, { steps: 8 }).catch(() => {});
      await page.waitForTimeout(100 + Math.random() * 100);
    }
  } catch (hoverErr) {
    logger.warn(`Mouse hover telemetry simulation failed: ${hoverErr.message}`);
  }

  if (useJS) {
    logger.info(`${name} Clicking via JS DOM...`);
    try {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
        } else {
          throw new Error("Element not found in DOM");
        }
      }, selector);
      logger.info(`${name} Clicked successfully via JS DOM`);
      await page.waitForTimeout(1000);
      return;
    } catch (jsErr) {
      logger.warn(`JS DOM Click failed for ${name}: ${jsErr.message}`);
      if (jsErr.message.includes("closed") || jsErr.message.includes("navigation") || jsErr.message.includes("context")) {
        throw jsErr;
      }
    }
  }

  logger.info(`${name} Clicking via Playwright Native Click...`);

  try {
    const element = page.locator(selector).first();
    // Scroll element fully into view before boundingBox extraction
    await element.scrollIntoViewIfNeeded().catch(() => {});
    const box = await element.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      // Calculate random start position slightly offset from the target
      const startX = Math.max(0, box.x - 40 + Math.random() * 80);
      const startY = Math.max(0, box.y - 40 + Math.random() * 80);
      await page.mouse.move(startX, startY).catch(() => {});
      
      const targetX = box.x + box.width / 2;
      const targetY = box.y + box.height / 2;
      
      logger.info(`Moving mouse smoothly to (${targetX.toFixed(1)}, ${targetY.toFixed(1)}) for ${name}...`);
      await page.mouse.move(targetX, targetY, { steps: 10 });
      await page.waitForTimeout(100 + Math.random() * 100);
      
      // Perform click natively at the specific mouse coordinates
      await page.mouse.click(targetX, targetY, { delay: 50 + Math.random() * 50 });
      logger.info(`${name} Clicked via Coordinate Mouse Click`);
      
      // Verification backup check: wait for a tiny delay, and if click didn't trigger, perform backup element.click()
      await page.waitForTimeout(500);
      return;
    } else {
      logger.warn(`${name} Bounding box not found or zero-sized, falling back to Playwright Click.`);
    }
  } catch (mouseErr) {
    logger.warn(`Mouse movement click failed for ${name}: ${mouseErr.message}. Falling back to standard click.`);
  }

  try {
    // Fallback Level 1: Normal Click
    await page.locator(selector).first().click({ timeout: 5000 });
  } catch (err) {
    logger.warn(`${name} Native normal click failed. Trying Level 2: Force Click...`);
    try {
      // Fallback Level 2: Force Click (bypasses actionability checks)
      await page.locator(selector).first().click({ force: true, timeout: 5000 });
    } catch (forceErr) {
      logger.error(`All click levels failed for ${name}: ${forceErr.message}`);
      throw forceErr;
    }
  }
  logger.info(`${name} Clicked via Playwright`);
  await page.waitForTimeout(1000);
}

// =====================================
// TYPE HUMANIZED
// =====================================

async function typeHumanized(page, selectorOrLocator, text) {
  const element = typeof selectorOrLocator === "string" 
    ? page.locator(selectorOrLocator).first()
    : selectorOrLocator;
  
  await element.focus();
  await element.fill("");
  for (const char of text) {
    const keyDelay = Math.floor(Math.random() * 100) + 50;
    await page.keyboard.type(char, { delay: keyDelay });
  }
}

// =====================================
// =====================================
// =====================================
// CAPTCHAAI OCR SOLVER
// =====================================

// =====================================
// ANTICAPTCHA SOLVER
// =====================================

async function solveAntiCaptcha(page, imageBuffer) {
  const apiKey = process.env.ANTICAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error("Anti-CAPTCHA API key is missing in .env");
  }
  const base64Data = imageBuffer.toString("base64");
  logger.info("Submitting Captcha solve task to Anti-CAPTCHA...");

  const postUrl = 'https://api.anti-captcha.com/createTask';
  try {
    const response = await page.request.post(postUrl, {
      data: {
        clientKey: apiKey,
        task: {
          type: "ImageToTextTask",
          body: base64Data,
          phrase: false,
          case: true,
          numeric: 4,
          math: false,
          minLength: 5,
          maxLength: 5
        }
      },
      timeout: 20000
    });

    if (response.status() !== 200) {
      throw new Error(`Anti-CAPTCHA createTask failed with HTTP status ${response.status()}`);
    }

    const submitResult = await response.json();
    if (submitResult.errorId !== 0) {
      throw new Error(`Anti-CAPTCHA error: ${submitResult.errorDescription} (code: ${submitResult.errorCode})`);
    }

    const taskId = submitResult.taskId;
    logger.info(`Anti-CAPTCHA Task submitted. Task ID: ${taskId}. Polling for result...`);

    const pollUrl = 'https://api.anti-captcha.com/getTaskResult';
    const startTime = Date.now();

    while (Date.now() - startTime < 120000) { // Max 120 seconds (2 minutes)
      await page.waitForTimeout(3000);
      const pollResponse = await page.request.post(pollUrl, {
        data: {
          clientKey: apiKey,
          taskId: taskId
        },
        timeout: 10000
      });

      if (pollResponse.status() === 200) {
        const pollResult = await pollResponse.json();
        if (pollResult.errorId !== 0) {
          throw new Error(`Anti-CAPTCHA polling error: ${pollResult.errorDescription}`);
        }
        if (pollResult.status === 'ready') {
          const solvedText = pollResult.solution.text ? pollResult.solution.text.trim() : "";
          if (solvedText.length === 5 && !solvedText.toUpperCase().includes("ERROR")) {
            logger.info(`Anti-CAPTCHA solved successfully: "${solvedText}"`);
            return solvedText;
          } else {
            throw new Error(`Anti-CAPTCHA returned invalid/error solution: "${solvedText}"`);
          }
        }
      }
    }
    throw new Error('Anti-CAPTCHA solve timeout');
  } catch (err) {
    throw new Error(`Anti-CAPTCHA failed: ${err.message}`);
  }
}

// =====================================
// 2CAPTCHA SOLVER
// =====================================

async function solve2Captcha(page, imageBuffer) {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) {
    throw new Error("2Captcha API key is missing in .env");
  }
  const base64Data = imageBuffer.toString("base64");
  logger.info("Submitting Captcha solve task to 2Captcha...");

  const postUrl = 'https://2captcha.com/in.php';
  try {
    const response = await page.request.post(postUrl, {
      form: {
        key: apiKey,
        method: 'base64',
        body: base64Data,
        numeric: '4',
        min_len: '5',
        max_len: '5',
        json: '1'
      },
      timeout: 20000
    });

    if (response.status() !== 200) {
      throw new Error(`2Captcha task submission failed with HTTP status ${response.status()}`);
    }

    const submitResult = await response.json();
    if (submitResult.status !== 1) {
      throw new Error(`2Captcha submission error: ${JSON.stringify(submitResult)}`);
    }

    const taskId = submitResult.request;
    logger.info(`2Captcha Task submitted. Task ID: ${taskId}. Polling for result...`);

    const pollUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`;
    const startTime = Date.now();

    while (Date.now() - startTime < 120000) { // Max 120 seconds (2 minutes)
      await page.waitForTimeout(3000);
      const pollResponse = await page.request.get(pollUrl, { timeout: 10000 });
      if (pollResponse.status() === 200) {
        const pollResult = await pollResponse.json();
        if (pollResult.status === 1) {
          const solvedText = pollResult.request ? pollResult.request.trim() : "";
          if (solvedText.length === 5 && !solvedText.toUpperCase().includes("ERROR")) {
            logger.info(`2Captcha solved successfully: "${solvedText}"`);
            return solvedText;
          } else {
            throw new Error(`2Captcha returned invalid/error solution: "${solvedText}"`);
          }
        }
        if (pollResult.request !== 'CAPCHA_NOT_READY') {
          throw new Error(`2Captcha polling error: ${JSON.stringify(pollResult)}`);
        }
      }
    }
    throw new Error('2Captcha solve timeout');
  } catch (err) {
    throw new Error(`2Captcha failed: ${err.message}`);
  }
}

// =====================================
// UNIFIED SOLVER WITH FALLBACK
// =====================================

async function solveCaptcha(page, imageBuffer) {
  try {
    // Attempt Primary: 2Captcha
    const result = await solve2Captcha(page, imageBuffer);
    return result;
  } catch (twoError) {
    logger.warn(`⚠️ Primary 2Captcha failed: ${twoError.message}. Switching to Anti-CAPTCHA fallback...`);
    try {
      // Attempt Fallback: Anti-CAPTCHA
      const result = await solveAntiCaptcha(page, imageBuffer);
      return result;
    } catch (antiError) {
      logger.error(`❌ Fallback Anti-CAPTCHA also failed: ${antiError.message}`);
      return "";
    }
  }
}

// =====================================
// ICP BOOKING FLOW
// =====================================

async function icpBookingFlow(page, user) {
  // Register dialog handler to auto-dismiss and log all browser alerts
  page.on("dialog", async (dialog) => {
    logger.warn(`⚠️ Browser Dialog Alert: "${dialog.message()}"`);
    await dialog.dismiss().catch(() => {});
  });

  // Anti-Bot Stealth Spoofs (Dynamic Hardware & WebGL Fingerprinting)
  const hardwareConcurrency = [4, 8, 12, 16][Math.floor(Math.random() * 4)];
  const deviceMemory = [4, 8, 16][Math.floor(Math.random() * 3)];
  const webglVendors = ['Intel Inc.', 'Google Inc. (NVIDIA)', 'ATI Technologies Inc.'];
  const webglRenderers = [
    'Intel(R) Iris(TM) Plus Graphics 640',
    'NVIDIA GeForce GTX 1650/PCIe/SSE2',
    'AMD Radeon(TM) Graphics',
    'Intel(R) UHD Graphics 620'
  ];
  const randomVendor = webglVendors[Math.floor(Math.random() * webglVendors.length)];
  const randomRenderer = webglRenderers[Math.floor(Math.random() * webglRenderers.length)];

  await page.addInitScript(({ hc, mem, vendor, renderer }) => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-ES', 'es', 'en-US', 'en'],
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => hc,
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => mem,
    });
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return vendor;
      if (parameter === 37446) return renderer;
      return getParameter.call(this, parameter);
    };
  }, { hc: hardwareConcurrency, mem: deviceMemory, vendor: randomVendor, renderer: randomRenderer }).catch(() => {});

  try {
    logger.info("==============================");
    logger.info("Starting ICP Booking Flow");
    logger.info("==============================");

    let stepStartTime = Date.now();

    // =====================================
    // STEP 1
    // PROVINCE
    // =====================================

    let tramitePageLoaded = false;
    for (let retryCount = 0; retryCount < 4; retryCount++) {
      if (retryCount > 0) {
        logger.warn(
          `⚠️ Retrying Province Selection (Attempt ${retryCount + 1})...`,
        );
        await safeReload(page);

        await checkPageBlockStatus(page);

        const result = await Promise.race([
          page
            .waitForSelector('select[id^="tramite"]', {
              state: "visible",
              timeout: 20000,
            })
            .then(() => "next"),
          page
            .waitForSelector("#form", { state: "visible", timeout: 20000 })
            .then(() => "current"),
        ]).catch(() => "timeout");

        if (result === "next") {
          tramitePageLoaded = true;
          logger.info("Reload successfully navigated to Tramite page!");
          break;
        }
      }

      try {
        await waitForDropdownReady(page, "#form", "Province Dropdown");

        const provinceOptions = await page
          .locator("#form option")
          .allTextContents();

        if (retryCount === 0) {
          logger.info(`Province Options: ${provinceOptions}`);
        }

        const provinceIndex = provinceOptions.findIndex(
          (o) => o.trim() === user.province,
        );

        if (provinceIndex === -1) {
          throw new Error(`Province not found: ${user.province}`);
        }

        // =====================================
        // SELECT PROVINCE NATIVELY
        // =====================================
        const provinceDropdown = page.locator("#form");
        logger.info(`Selecting Province Option Index: ${provinceIndex}`);
        await provinceDropdown.selectOption({ index: provinceIndex });

        // Force dispatch events so the frontend framework registers the change
        await provinceDropdown.evaluate((node) => {
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
          node.dispatchEvent(new Event("blur", { bubbles: true }));
        });
        await page.waitForTimeout(1000);

        // Validation
        let selectedValue = await provinceDropdown.evaluate((el) => el.value);
        if (
          !selectedValue ||
          selectedValue === "" ||
          selectedValue === "0" ||
          selectedValue === "-1" ||
          selectedValue.includes("Seleccione")
        ) {
          throw new Error(
            "Failed to set Province value natively. Aborting before clicking Aceptar.",
          );
        }

        logger.info(`Province Selected: ${user.province}`);

        // ACCEPT
        logger.info(
          "Applying 3-second delay to bypass WAF bot detection before submitting...",
        );
        await safeClick(page, "#btnAceptar", "First Accept Button", false);

        logger.info(
          "Checking if route is successful. Waiting up to 30 seconds...",
        );
        let routed = false;
        let notAvailable = false;
        for (let t = 1; t <= 30; t++) {
          await page.waitForTimeout(1000);
          logger.info(`Route Check Timer: ${t}s...`);
          await checkPageBlockStatus(page);
          const status = await page
            .evaluate(() => {
              const hasOficina = document.querySelectorAll("#sede").length > 0;
              const hasTramite =
                document.querySelectorAll('select[id^="tramite"]').length > 0;
              const hasNoCitas =
                document.body &&
                document.body.innerText.includes("No hay citas");
              const isNotAvailable = 
                document.body && (
                  document.body.innerText.includes("no ofrece el servicio de Cita Previa") ||
                  document.body.innerText.includes("no ofrece el servicio")
                );
              return {
                isRouted: hasOficina || hasTramite || hasNoCitas,
                isNotAvailable: !!isNotAvailable
              };
            })
            .catch(() => ({ isRouted: false, isNotAvailable: false }));

          if (status.isNotAvailable) {
            notAvailable = true;
            break;
          }

          if (status.isRouted) {
            routed = true;
            logger.info("Route successful! Proceeding to next page.");
            break;
          }
        }

        if (notAvailable) {
          throw new Error("Province does not offer internet appointment service for any procedure");
        }

        if (!routed) {
          await logClickFailureState(page, "First_Accept_Button");
          throw new Error(
            "Route did not change after clicking First Accept Button. Forcing reload.",
          );
        }

        tramitePageLoaded = true;
        logger.info(`[LATENCY] Step 1 (Province Selection) completed in ${Date.now() - stepStartTime}ms`);
        stepStartTime = Date.now();
        break; // Success! Exit the retry loop
      } catch (err) {
        if (err.message.includes("does not offer internet appointment")) {
          throw err;
        }
        logger.warn(`⚠️ Error in Province step: ${err.message}. Retrying...`);
      }
    }

    if (!tramitePageLoaded) {
      throw new Error(
        "Failed to load Tramite page after Province selection (Persistent error)",
      );
    }

    logger.info(`Current URL: ${page.url()}`);

    // Oficina logic moved inside the Tramite retry loop below.

    // =====================================
    // STEP 2
    // TRAMITE
    // =====================================

    logger.info("Waiting for Tramite page elements to load...");
    await page.locator("#sede, select[id^='tramite']").first().waitFor({ state: "attached", timeout: 10000 }).catch(() => {});

    let nextPageLoaded = false;
    for (let retryCount = 0; retryCount < 4; retryCount++) {
      if (retryCount > 0) {
        logger.warn(
          `⚠️ Retrying Tramite Selection (Attempt ${retryCount + 1})...`,
        );
        await safeReload(page, true);

        for (let t = 1; t <= 30; t++) {
          await page.waitForTimeout(1000);
          const isBlank = await checkPageBlockStatus(page);
          if (!isBlank) break;
        }

        await page
          .waitForSelector("#btnAceptar, #btnEntrar, #btnEnviar", {
            state: "visible",
            timeout: 20000,
          })
          .catch(() => {});
        await page.waitForTimeout(1000);
        const hasTramite =
          (await page.locator('select[id^="tramite"]').count()) > 0;

        if (!hasTramite) {
          nextPageLoaded = true;
          logger.info("Reload successfully navigated to Next page!");
          break;
        }
      }

      // =====================================
      // STEP 1.5: OFICINA (Moved inside loop)
      // =====================================
      try {
        const sedeExists = await page
          .waitForSelector("#sede", { state: "attached", timeout: 2000 })
          .catch(() => null);
        if (sedeExists) {
          const oficinaDropdown = page.locator("#sede");
          logger.info("Oficina dropdown detected.");
          if (user.oficina && user.oficina !== "Cualquier oficina") {
            logger.info(
              `Attempting to select specific oficina: ${user.oficina}`,
            );
            const options = await oficinaDropdown
              .locator("option")
              .allTextContents();

            const normalizeStr = (str) =>
              str
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .trim();
            const targetNormalized = normalizeStr(user.oficina);

            let matchIndex = -1;
            for (let i = 0; i < options.length; i++) {
              if (normalizeStr(options[i]).includes(targetNormalized)) {
                matchIndex = i;
                break;
              }
            }

            if (matchIndex !== -1) {
              const ajaxWait = page
                .waitForResponse(
                  (response) =>
                    response.url().includes("/icpplus/selectSede") &&
                    response.request().method() === "POST",
                  { timeout: 15000 },
                )
                .catch(() => null);
              await oficinaDropdown.selectOption({ index: matchIndex });
              logger.info(`Selected Oficina: ${options[matchIndex].trim()}`);
              await ajaxWait;
              await page.waitForTimeout(500); // Give DOM half a second to process the response
            } else {
              logger.warn(
                `Oficina '${user.oficina}' not found, falling back to default`,
              );
            }
          }

          // Wait up to 5 seconds to see if a Tramite dropdown populates with options dynamically
          // Check if a Tramite select element exists on the page
          const tramiteSelectExists = await page.evaluate(() => {
            return document.querySelectorAll('select[id^="tramite"]').length > 0;
          });

          if (tramiteSelectExists) {
            logger.info("Tramite dropdown is present on this page. Waiting for it to populate dynamically...");
            const populated = await page.waitForFunction(() => {
              const selects = document.querySelectorAll('select[id^="tramite"]');
              for (let s of selects) {
                if (s.options && s.options.length > 1) return true;
              }
              return false;
            }, { timeout: 25000 }).then(() => true).catch(() => false);
            if (!populated) {
              logger.warn("Tramite dropdown did not populate within 25 seconds.");
            }
          } else {
            logger.info("Tramite dropdown is not present. Clicking Aceptar to load procedures page...");
            await safeClick(page, "#btnAceptar", "Oficina Accept Button", false);
            
            // Wait for the page to route/reload and display the Tramite dropdown
            logger.info("Waiting for page to update after Oficina selection...");
            await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
            
            // Wait for Tramite dropdown to load
            await page.waitForFunction(() => {
              const selects = document.querySelectorAll('select[id^="tramite"]');
              if (selects.length === 0) return false;
              for (let s of selects) {
                if (s.options && s.options.length > 1) return true;
              }
              return false;
            }, { timeout: 25000 }).catch(() => {
              logger.warn("Tramite dropdown did not load after clicking Oficina Accept.");
            });
          }
        }
      } catch (err) {
        logger.warn(`Error handling Oficina dropdown: ${err.message}`);
      }

      try {
        // 15-Second Blank Screen Check for Tramite Dropdowns
        for (let t = 1; t <= 15; t++) {
          await page.waitForTimeout(1000);
          const isReady = await page
            .evaluate(() => {
              const selects = document.querySelectorAll(
                'select[id^="tramite"]',
              );
              if (selects.length === 0) return false;
              for (let s of selects) {
                if (s.options && s.options.length > 1) return true;
              }
              return false;
            })
            .catch(() => false);
          if (isReady) break;

          const isBlank = await checkPageBlockStatus(page);
          if (!isBlank) break; // Page has normal content, proceed to normal wait

          logger.warn(`Blank Screen Timer (Tramite Dropdowns): ${t}s...`);
          if (t === 15)
            throw new Error(
              "Screen is completely blank after 15 seconds. Force reloading.",
            );
        }

        // Smart Event-Driven Wait: Wait until the Tramite dropdowns are attached AND have actual options loaded inside them
        await page
          .waitForFunction(
            () => {
              const selects = document.querySelectorAll(
                'select[id^="tramite"]',
              );
              if (selects.length === 0) return false;
              for (let s of selects) {
                if (s.options && s.options.length > 1) return true;
              }
              return false;
            },
            { timeout: 25000 },
          )
          .catch(() => null);

        // Find the specific dropdown that contains our target tramite
        const allSelects = page.locator('select[id^="tramite"]');
        const selectCount = await allSelects.count();

        if (selectCount === 0) {
          throw new Error(
            "No Tramite dropdowns found on the page after waiting. The page might be stuck loading or the DOM changed.",
          );
        } else {
          let targetDropdown = null;
          let exactOptionText = null;
          let targetOptionIndex = -1;

          // Helper to remove accents and make lowercase
          const normalizeStr = (str) =>
            str
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .trim();
          const targetNormalized = normalizeStr(user.tramite);

          for (let i = 0; i < selectCount; i++) {
            const options = await allSelects
              .nth(i)
              .locator("option")
              .allTextContents();
            for (let j = 0; j < options.length; j++) {
              const opt = options[j];
              if (normalizeStr(opt).includes(targetNormalized)) {
                targetDropdown = allSelects.nth(i);
                exactOptionText = opt.trim();
                targetOptionIndex = j;
                break;
              }
            }
            if (targetDropdown) break;
          }

          if (!targetDropdown) {
            logger.warn(
              `Tramite '${user.tramite}' not found. Attempting Fallback Selection...`,
            );
            for (let i = 0; i < selectCount; i++) {
              const options = await allSelects
                .nth(i)
                .locator("option")
                .allTextContents();
              for (let j = 0; j < options.length; j++) {
                const optText = options[j].trim();
                const optLower = optText.toLowerCase();
                if (
                  optText &&
                  !optLower.includes("seleccione") &&
                  !optLower.includes("despliega")
                ) {
                  targetDropdown = allSelects.nth(i);
                  exactOptionText = optText;
                  targetOptionIndex = j;
                  logger.info(
                    `Fallback Selected First Valid Option: ${exactOptionText}`,
                  );
                  break;
                }
              }
              if (targetDropdown) break;
            }

            if (!targetDropdown) {
              let allOpts = [];
              for (let i = 0; i < selectCount; i++) {
                allOpts.push(
                  ...(await allSelects
                    .nth(i)
                    .locator("option")
                    .allTextContents()),
                );
              }
              logger.error(`Available options were: ${allOpts.join(" | ")}`);
              throw new Error(
                `Fallback failed: No valid Tramite options found in any dropdown.`,
              );
            }
          }

          logger.info(
            `Exact Tramite Found: ${exactOptionText} at Index: ${targetOptionIndex}`,
          );

          // =====================================
          // SELECT TRAMITE NATIVELY
          // =====================================
          logger.info(`Selecting Tramite Option Index: ${targetOptionIndex}`);
          await targetDropdown.selectOption({ index: targetOptionIndex });

          // Force dispatch events so the frontend framework registers the change
          await targetDropdown.evaluate((node) => {
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
            node.dispatchEvent(new Event("blur", { bubbles: true }));
          });
          await page.waitForTimeout(1000);

          // Verification
          let selectedValue = await targetDropdown.evaluate((el) => el.value);
          if (
            !selectedValue ||
            selectedValue === "" ||
            selectedValue === "0" ||
            selectedValue === "-1"
          ) {
            throw new Error(
              "Failed to set the Tramite value in the dropdown natively. Aborting before clicking Aceptar.",
            );
          }

          logger.info(`Tramite Selected: ${exactOptionText}`);
        }

        // Check if the page is already navigating or has already routed to the next page
        await page.waitForTimeout(1500); // Wait a brief moment to see if auto-submit triggers
        const currentUrl = page.url();
        if (currentUrl.includes("/acInfo") || currentUrl.includes("/acEntrar")) {
          logger.info("Page auto-routed after Tramite selection. Skipping Second Accept Button click.");
        } else {
          logger.info("Applying 3-second delay before clicking Accept...");
          await page.waitForTimeout(3000);

          // ACCEPT
          await safeClick(page, "#btnAceptar", "Second Accept Button", false);
        }

        // =====================================
        // WAIT FOR TRAMITE PAGE TO UNLOAD (ROUTE CHECK)
        // =====================================
        logger.info(
          "Checking if route is successful. Waiting up to 15 seconds...",
        );
        let routed = false;
        for (let t = 1; t <= 30; t++) {
          await page.waitForTimeout(1000);
          logger.info(`Route Check Timer: ${t}s...`);

          const isBlank = await checkPageBlockStatus(page);

          // Check if the Tramite dropdowns are gone, which means we navigated away
          const isStillHere = await page
            .evaluate(
              () =>
                document.querySelectorAll('select[id^="tramite"]').length > 0,
            )
            .catch(() => false);
          if (!isStillHere && !isBlank) {
            routed = true;
            logger.info("Route successful! Proceeding to next page.");
            break;
          }
        }

        if (!routed) {
          await logClickFailureState(page, "Second_Accept_Button");
          throw new Error(
            "Route did not change after clicking Accept. The click was likely dropped. Forcing reload to retry.",
          );
        }

        // =====================================
        // CHECK FOR OPTIONAL WARNING PAGE
        // =====================================
        await page.waitForSelector("#btnAceptar, #btnEntrar, #btnEnviar", {
          timeout: 20000,
        });
        nextPageLoaded = true;
        logger.info(`[LATENCY] Step 2 (Tramite Selection) completed in ${Date.now() - stepStartTime}ms`);
        stepStartTime = Date.now();
        break; // Success! Exit loop
      } catch (err) {
        logger.warn(`⚠️ Error in Tramite step: ${err.message}. Retrying...`);
      }
    }

    if (!nextPageLoaded) {
      throw new Error(
        "Failed to load next page after Tramite selection (Persistent Blank Page)",
      );
    }

    const btnAceptarWarning = page.locator("#btnAceptar");
    if ((await btnAceptarWarning.count()) > 0) {
      logger.info("Warning Page Detected. Clicking Accept...");

      // Wait for the actual Entry page after the warning
      let entryPageLoaded = false;
      for (let retryCount = 0; retryCount < 4; retryCount++) {
        if (retryCount > 0) {
          logger.warn(
            `⚠️ Retrying Warning Accept (Attempt ${retryCount + 1})...`,
          );
          await safeReload(page);

          await checkPageBlockStatus(page);

          const result = await Promise.race([
            page
              .waitForSelector("#btnEntrar, #btnEnviar", {
                state: "visible",
                timeout: 20000,
              })
              .then(() => "next"),
            page
              .waitForSelector("#btnAceptar", {
                state: "visible",
                timeout: 20000,
              })
              .then(() => "current"),
          ]).catch(() => "timeout");

          const hasTramite =
            (await page.locator('select[id^="tramiteGrupo"]').count()) > 0;
          if (hasTramite) {
            throw new Error(
              "Reload landed back on Tramite page! Browser state corrupted, restarting flow.",
            );
          }

          if (result === "next") {
            entryPageLoaded = true;
            logger.info("Reload successfully navigated to Entry page!");
            break;
          }
        }

        try {
          await safeClick(page, "#btnAceptar", "Warning Accept Button", false);

          await page.waitForSelector("#btnEntrar, #btnEnviar", {
            timeout: 20000,
          });
          entryPageLoaded = true;
          break;
        } catch (err) {
          logger.warn(`⚠️ Error in Warning step: ${err.message}. Retrying...`);
        }
      }

      if (!entryPageLoaded) {
        throw new Error(
          "Failed to load Entry page after Warning page (Persistent Blank Page)",
        );
      }
    }

    logger.info("Entry Page Ready");

    logger.info(`Current URL: ${page.url()}`);

    // =====================================
    // STEP 3
    // PRESENTACION SIN CLAVE
    // =====================================

    logger.info("Applying 1-second delay for Entry Page stabilization...");
    await page.waitForTimeout(1000);

    const btnEnviar = page.locator("#btnEnviar");
    const btnEntrar = page.locator("#btnEntrar");

    if ((await btnEnviar.count()) > 0) {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
          .catch(() => {}),
        safeClick(page, "#btnEnviar", "Presentacion Sin Cl@ve Button"),
      ]);
    } else if ((await btnEntrar.count()) > 0) {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
          .catch(() => {}),
        safeClick(page, "#btnEntrar", "Entrar Button"),
      ]);
    }

    // =====================================
    // STEP 4 & 5
    // PASSPORT & SUBMIT
    // =====================================

    let optionsPageLoaded = false;
    for (let retryCount = 0; retryCount < 4; retryCount++) {
      if (retryCount > 0) {
        logger.warn(
          `⚠️ Retrying Passport Submission (Attempt ${retryCount + 1})...`,
        );
        await safeReload(page);

        await page.waitForSelector("body", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const hasPassport = (await page.locator("#txtIdCitado").count()) > 0;
        await checkPageBlockStatus(page);
        const bodyText = await page.textContent("body").catch(() => "");

        if (!hasPassport && bodyText.trim().length > 50) {
          optionsPageLoaded = true;
          logger.info("Reload successfully navigated past Passport page!");
          break;
        }
      }

      try {
        logger.info("Waiting for page navigation to settle...");
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);
        await checkPageBlockStatus(page);

        const bodyTextRaw = await page.textContent("body").catch(() => "");
        if (
          bodyTextRaw.includes(
            "La provincia seleccionada no ofrece el servicio de Cita Previa Internet para ningún trámite",
          )
        ) {
          throw new Error(
            "No appointments available for this Province/Tramite combination (Extranjeria rejected immediately)",
          );
        }

        // Wait for the form to actually render on the page
        await page
          .waitForSelector('input[type="text"], select', {
            state: "visible",
            timeout: 20000,
          })
          .catch(() => {
            logger.warn(
              "No text inputs or selects appeared within 20s. Form might not be loaded properly.",
            );
          });
        await page.locator('input[type="text"], select').first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

        // =====================================
        // SMART DYNAMIC FORM FILLER
        // =====================================

        // 1. First, handle the Radio button (Doc Type) if it exists
        const passportRadio = page.locator("#rdbTipoDocPas");
        const nieRadio = page.locator("#rdbTipoDocNie");
        const dniRadio = page.locator("#rdbTipoDocDni");

        if (user.docType === "PASAPORTE" && (await passportRadio.count()) > 0) {
          await passportRadio.check({ force: true }).catch(() => {});
          await page.evaluate(() => {
            const r = document.querySelector("#rdbTipoDocPas");
            if (r) {
              r.click();
              r.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        } else if (user.docType === "N.I.E." && (await nieRadio.count()) > 0) {
          await nieRadio.check({ force: true }).catch(() => {});
          await page.evaluate(() => {
            const r = document.querySelector("#rdbTipoDocNie");
            if (r) {
              r.click();
              r.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        } else if (user.docType === "D.N.I." && (await dniRadio.count()) > 0) {
          await dniRadio.check({ force: true }).catch(() => {});
          await page.evaluate(() => {
            const r = document.querySelector("#rdbTipoDocDni");
            if (r) {
              r.click();
              r.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
        }
        // Removed unnecessary 1000ms delay

        // 2. Discover all text/select inputs and their associated labels
        const fieldsToFill = await page.evaluate(() => {
          const inputs = Array.from(
            document.querySelectorAll(
              'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]), select',
            ),
          );
          const mapping = [];

          inputs.forEach((input) => {
            if (
              input.disabled ||
              input.type === "hidden" ||
              input.style.display === "none"
            )
              return;

            // Try to find the label
            let labelText = "";
            const id = input.id;
            if (id) {
              const labelEl = document.querySelector(`label[for="${id}"]`);
              if (labelEl) labelText = labelEl.innerText.trim().toLowerCase();
            }
            if (!labelText && input.parentElement) {
              labelText = input.parentElement.innerText.trim().toLowerCase();
            }

            mapping.push({
              id: id,
              type: input.tagName.toLowerCase(),
              label: labelText,
            });
          });
          return mapping;
        });

        logger.info(
          `Detected fields on page: ${JSON.stringify(fieldsToFill.map((f) => f.label))}`,
        );

        if (fieldsToFill.length === 0) {
          throw new Error(
            "No form fields detected. Page might still be loading or WAF blocked.",
          );
        }

        // Helper to normalize strings
        const normalize = (str) =>
          str
            ? str
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .trim()
            : "";

        // 3. Fill the fields dynamically based on labels
        for (const field of fieldsToFill) {
          if (!field.id) continue;

          const label = normalize(field.label);
          const selector = `#${field.id}`;

          if (
            label.includes("documento") ||
            label.includes("pasaporte") ||
            label.includes("n.i.e") ||
            label.includes("d.n.i")
          ) {
            await typeHumanized(page, selector, user.passport);
            const val = await page.$eval(selector, (el) => el.value);
            if (!val) throw new Error("Failed to fill Document Number");
            logger.info(`Filled Document Number: ${user.passport}`);
          } else if (label.includes("nombre") || label.includes("apellidos")) {
            // Sanitize name: Extranjeria blocks numbers and special characters in the name field
            let sanitizedName = user.name
              .replace(/[0-9]/g, "")
              .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, "")
              .trim();
            if (!sanitizedName) sanitizedName = user.name; // Fallback to original if it becomes empty

            await typeHumanized(page, selector, sanitizedName);
            const val = await page.$eval(selector, (el) => el.value);
            if (!val) throw new Error("Failed to fill Name");
            logger.info(`Filled Name: ${sanitizedName}`);
          } else if (
            label.includes("ano de nacimiento") ||
            label.includes("nacimiento")
          ) {
            if (user.birthYear) {
              await typeHumanized(page, selector, user.birthYear);
              const val = await page.$eval(selector, (el) => el.value);
              if (!val) throw new Error("Failed to fill Birth Year");
              logger.info(`Filled Birth Year: ${user.birthYear}`);
            } else {
              logger.warn(
                "Form requires Birth Year but it was not provided in Job!",
              );
            }
          } else if (label.includes("caducidad") || label.includes("fecha")) {
            if (user.expiryDate) {
              await typeHumanized(page, selector, user.expiryDate);
              const val = await page.$eval(selector, (el) => el.value);
              if (!val) throw new Error("Failed to fill Expiry Date");
              logger.info(`Filled Expiry Date: ${user.expiryDate}`);
            }
          } else if (label.includes("nacionalidad") || label.includes("pais")) {
            if (user.nationality && field.type === "select") {
              const options = await page
                .locator(`${selector} option`)
                .allTextContents();
              const target = normalize(user.nationality);
              let matchIndex = -1;
              for (let i = 0; i < options.length; i++) {
                if (normalize(options[i]).includes(target)) {
                  matchIndex = i;
                  break;
                }
              }
              if (matchIndex !== -1) {
                await page
                  .locator(selector)
                  .selectOption({ index: matchIndex });
                logger.info(
                  `Selected Nationality: ${options[matchIndex].trim()}`,
                );
              }
            }
          }
        }

        // Submit
        logger.info(
          "Applying 3-second delay to bypass WAF bot detection before submitting...",
        );
        await page.waitForTimeout(3000);
        await safeClick(page, "#btnEnviar", "Submit Button", false);

        // =====================================
        // ROUTE CHECK TIMER
        // =====================================
        logger.info(
          "Checking if route is successful. Waiting up to 30 seconds...",
        );
        let routed = false;
        for (let t = 1; t <= 30; t++) {
          await page.waitForTimeout(1000);
          logger.info(`Route Check Timer: ${t}s...`);
          await checkPageBlockStatus(page);

          // Look for Extranjeria red validation errors on the page (e.g. "El nombre y apellidos no puede contener números")
          const validationError = await page
            .evaluate(() => {
              const errorElements = document.querySelectorAll(
                '.mf-msg__info, .error-message, [style*="color: red"], [style*="color:red"], span[class*="error"], div[class*="error"]',
              );
              for (let el of errorElements) {
                const txt = el.innerText.trim();
                if (
                  txt.length > 0 &&
                  (txt.includes("no puede contener") ||
                    txt.includes("obligatorio") ||
                    txt.includes("incorrecto"))
                ) {
                  return txt;
                }
              }
              if (
                document.body &&
                document.body.innerText.includes(
                  "El nombre y apellidos no puede contener números",
                )
              ) {
                return "El nombre y apellidos no puede contener números ni caracteres especiales.";
              }
              return null;
            })
            .catch(() => null);

          if (validationError) {
            throw new Error(
              `Data Validation Error on Extranjeria form: "${validationError}". Please fix the job data.`,
            );
          }

          // Check if the passport input field is gone, which means we navigated away
          const isStillHere = await page
            .evaluate(() => document.querySelectorAll("#txtIdCitado").length > 0)
            .catch(() => false);
          if (!isStillHere) {
            routed = true;
            logger.info("Route successful! Proceeding to next page.");
            break;
          }
        }

        if (!routed) {
          throw new Error(
            "Route did not change after clicking Submit. The click was likely dropped. Forcing reload to retry.",
          );
        }
        // Wait for next page to load by checking DOM
        await page.waitForFunction(
          () => {
            return (
              document.body &&
              document.body.innerText.trim().length > 50 &&
              !document.querySelector("#txtIdCitado")
            );
          },
          { timeout: 35000 },
        ); // REMOVED silent catch so it properly throws on timeout!

        logger.info("Form Submitted");
        optionsPageLoaded = true;
        break;
      } catch (err) {
        logger.warn(
          `⚠️ Error in dynamic form filling step: ${err.message}. Retrying...`,
        );
      }
    }

    if (!optionsPageLoaded) {
      throw new Error("Failed to submit Passport details (Persistent error)");
    }

    // =====================================
    // STEP 6 & 7
    // OPCIONES DE LA CITA & RESULT
    // =====================================
    let resultPageLoaded = false;
    let appointmentStatus = "unknown";
    let step6RefreshAttempt = 0;

    while (true) {
      if (page.isClosed()) {
        throw new Error("Target page, context or browser has been closed");
      }

      await checkPageBlockStatus(page);

      // Check if we are on the warning page (Normal or Cl@ve)
      const content = await page.textContent("body").catch(() => "");
      const lowerContent = content.toLowerCase();

      if (lowerContent.includes("no hay citas disponibles") || lowerContent.includes("no hay citas") || lowerContent.includes("no existen citas")) {
        // 1. If Cl@ve warning -> Restart instantly
        if (lowerContent.includes("cl@ve") || lowerContent.includes("clave")) {
          logger.info("[CL@VE WARNING DETECTED]: Appointments only available via Cl@ve. Refreshing page in 3 seconds to try again...");
          await page.waitForTimeout(3000);
          try {
            await safeReload(page);
          } catch (err) {
            logger.error(`[CL@VE Refresh] Reload failed: ${err.message}`);
          }
          continue;
        }

        // 2. Check if there is an operation code (Cod. Oper.)
        const hasCodOper = lowerContent.includes("cod. oper") || lowerContent.includes("cod.oper");
        if (hasCodOper) {
          logger.info("🚨 [COD. OPER DETECTED]: Warning page has an operation code. Terminating session to get a new one...");
          appointmentStatus = "unavailable";
          resultPageLoaded = true;
          break;
        }

        // 3. Normal warning without Cod. Oper. -> Stay on page, wait 35 seconds, reload, and continue!
        step6RefreshAttempt++;
        logger.info(`[Step 6 Refresh Attempt #${step6RefreshAttempt}] Normal 'No hay citas' warning page (NO Cod. Oper.) detected.`);
        logger.info(`[Step 6 Refresh Attempt #${step6RefreshAttempt}] Waiting 20 seconds to simulate human-like delay...`);
        await page.waitForTimeout(20000);

        logger.info(`[Step 6 Refresh Attempt #${step6RefreshAttempt}] Reloading page directly...`);
        try {
          await safeReload(page);
        } catch (err) {
          logger.error(`[Step 6 Refresh Attempt #${step6RefreshAttempt}] Reload failed: ${err.message}`);
        }
        continue;
      }

      // Check if we are on the next page (Office/Contact page) already
      const hasSiguiente = (await page.locator("#btnSiguiente, input[value='Siguiente'], input[name='txtTelefono'], input[type='tel']").count().catch(() => 0)) > 0;
      if (hasSiguiente) {
        logger.info("🎉 Step 6: Next page loaded successfully!");
        appointmentStatus = "available";
        resultPageLoaded = true;
        break;
      }

      // Otherwise we should be on the Opciones page. Fill form if required and click Solicitar Cita.
      try {
        // Wait for the Solicitar button to be visible on page load
        const btnSolicitarVisible = await page.waitForSelector("#btnEnviar", { state: "visible", timeout: 5000 }).then(() => true).catch(() => false);

        if (!btnSolicitarVisible) {
          // If not visible, check if we landed directly on a warning page (we loop and check text next iteration)
          const bodyText = await page.textContent("body").catch(() => "");
          if (bodyText.toLowerCase().includes("no hay citas") || bodyText.toLowerCase().includes("no existen citas")) {
            continue;
          } else {
            throw new Error("Solicitar Cita button not visible on Step 6 page load.");
          }
        } else {          logger.info("Applying 1.5-second delay to bypass WAF bot detection before clicking Solicitar...");
          await page.waitForTimeout(1500);

          // Handle Radio button (Doc Type) on Step 6 if it exists
          const passportRadioExtra = page.locator("#rdbTipoDocPas");
          const nieRadioExtra = page.locator("#rdbTipoDocNie");
          const dniRadioExtra = page.locator("#rdbTipoDocDni");

          if (user.docType === "PASAPORTE" && (await passportRadioExtra.count()) > 0) {
            logger.info("Step 6: Selecting PASAPORTE radio button...");
            await passportRadioExtra.check({ force: true }).catch(() => {});
            await page.evaluate(() => {
              const r = document.querySelector("#rdbTipoDocPas");
              if (r) {
                r.click();
                r.dispatchEvent(new Event("change", { bubbles: true }));
              }
            });
          } else if (user.docType === "N.I.E." && (await nieRadioExtra.count()) > 0) {
            logger.info("Step 6: Selecting N.I.E. radio button...");
            await nieRadioExtra.check({ force: true }).catch(() => {});
            await page.evaluate(() => {
              const r = document.querySelector("#rdbTipoDocNie");
              if (r) {
                r.click();
                r.dispatchEvent(new Event("change", { bubbles: true }));
              }
            });
          } else if (user.docType === "D.N.I." && (await dniRadioExtra.count()) > 0) {
            logger.info("Step 6: Selecting D.N.I. radio button...");
            await dniRadioExtra.check({ force: true }).catch(() => {});
            await page.evaluate(() => {
              const r = document.querySelector("#rdbTipoDocDni");
              if (r) {
                r.click();
                r.dispatchEvent(new Event("change", { bubbles: true }));
              }
            });
          }

          // Handle extra fields asking for Passport/Name on Step 6
          const extraFields = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
            return inputs.map(input => {
               let labelText = "";
               if (input.id) {
                 const labelEl = document.querySelector(`label[for="${input.id}"]`);
                 if (labelEl) labelText = labelEl.innerText.trim().toLowerCase();
               }
               if (!labelText && input.parentElement) {
                 labelText = input.parentElement.innerText.trim().toLowerCase();
               }
               return { id: input.id, label: labelText };
            });
          });

          for (const field of extraFields) {
            if (!field.id) continue;
            const selector = `#${field.id}`;
            const label = field.label;
            
            if (label.includes("documento") || label.includes("pasaporte") || label.includes("n.i.e") || label.includes("d.n.i")) {
              logger.info("Found extra Document field on Step 6. Filling...");
              await typeHumanized(page, selector, user.passport);
            } else if (label.includes("nombre") || label.includes("apellidos")) {
              logger.info("Found extra Name field on Step 6. Filling...");
              let sanitizedName = user.name.replace(/[0-9]/g, "").replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, "").trim();
              if (!sanitizedName) sanitizedName = user.name;
              await typeHumanized(page, selector, sanitizedName);
            }
          }

          logger.info("Clicking Solicitar Cita...");
          await safeClick(page, "#btnEnviar", "Solicitar Cita Button", false);

          logger.info("Checking route change after clicking Solicitar Cita...");
          const raceResult = await page.waitForFunction(() => {
            const hasSiguiente = document.querySelectorAll("#btnSiguiente, input[value='Siguiente'], input[name='txtTelefono'], input[type='tel']").length > 0;
            const bodyText = document.body ? document.body.innerText.toLowerCase() : "";
            const hasNoCitas = bodyText.includes("no hay citas") || bodyText.includes("no existen citas");
            
            // F5 ASM WAF Block check
            const isBlocked = 
              bodyText.includes("requested url was rejected") || 
              bodyText.includes("support id") || 
              bodyText.includes("consult with your administrator") ||
              bodyText.includes("403 forbidden") ||
              document.title.includes("Request Rejected");

            if (hasSiguiente) return "available";
            if (hasNoCitas) return "unavailable";
            if (isBlocked) return "blocked";
            return null;
          }, {}, { timeout: 25000 }).then(handle => handle.jsonValue()).catch(() => "timeout");

          logger.info(`Step 6 Route result: ${raceResult}`);

          if (raceResult === "available") {
            appointmentStatus = "available";
            resultPageLoaded = true;
            break;
          } else if (raceResult === "unavailable") {
            appointmentStatus = "unavailable";
            // Loop continues and checks the warning page content in next iteration
            continue;
          } else if (raceResult === "blocked") {
            throw new Error("WAF Blocked/Server Error (403/429/500). Session corrupted, restarting flow.");
          } else {
            logger.warn("Step 6 click timed out. Reloading page directly...");
            await safeReload(page).catch(() => {});
            await page.waitForTimeout(5000);
          }
        }
      } catch (err) {
        logger.error(`Error in Step 6: ${err.message}`);
        await safeReload(page).catch(() => {});
        await page.waitForTimeout(5000);
      }
    }

    if (!resultPageLoaded) {
      throw new Error("Failed to load Result page after Solicitar Cita");
    }

    if (appointmentStatus === "unavailable") {
      logger.info("No Appointment Available");
      return { success: false, reason: "No appointments available" };
    }

    logger.info("🎉 Slots found! Updating job status to booking...");
    const JobModel = require("../db/models/Job");
    await JobModel.findByIdAndUpdate(user.jobId, { status: "booking", failureReason: "Slots found! Booking in progress..." }).catch(() => {});

    logger.info("Proceeding to Office Selection...");

    // =====================================
    // STEP 8
    // SELECCIONA OFICINA (Siguiente)
    // =====================================
    logger.info("=== STEP 8: SELECCIONA OFICINA (Siguiente) ===");

    // Wait for Siguiente button or contact page fields to load
    await page.waitForSelector(
      "#btnSiguiente, input[value='Siguiente'], input[name='txtTelefono'], input[type='tel']",
      { timeout: 15000 }
    ).catch(() => {});

    // Check if we are already on the Contact page
    const isContactPageAlready = await page.evaluate(() => {
      return document.querySelectorAll('input[name="txtTelefono"], input[type="tel"]').length > 0;
    }).catch(() => false);

    if (!isContactPageAlready) {
      // Find all select elements on the page to check if Oficina dropdown is present
      const selectElements = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('select')).map(s => ({
          id: s.id,
          name: s.name,
          optionsCount: s.options ? s.options.length : 0
        }));
      }).catch(() => []);
      logger.info(`Detected select elements on acCitar page: ${JSON.stringify(selectElements)}`);

      let officeSelector = null;
      if (await page.locator("#sede").count() > 0) {
        officeSelector = "#sede";
      } else if (await page.locator("#idSede").count() > 0) {
        officeSelector = "#idSede";
      } else if (selectElements.length > 0) {
        officeSelector = selectElements[0].id ? `select#${selectElements[0].id}` : (selectElements[0].name ? `select[name="${selectElements[0].name}"]` : "select");
      }

      if (officeSelector) {
        logger.info(`Oficina dropdown detected via selector: ${officeSelector}`);
        const oficinaDropdown = page.locator(officeSelector);
        
        // Wait for dropdown to have options (more than 1 option) for up to 3 seconds
        await page.waitForFunction(
          (sel) => {
            const d = document.querySelector(sel);
            return d && d.options && d.options.length > 1;
          },
          officeSelector,
          { timeout: 3000 }
        ).catch(() => {
          logger.warn("Oficina dropdown options did not load within 3s");
        });

        const options = await oficinaDropdown.locator("option").allTextContents();

        const selectFirstValidOficina = async (dropdown, opts) => {
          let firstValidIndex = -1;
          for (let i = 0; i < opts.length; i++) {
            const text = opts[i].toLowerCase();
            if (text && !text.includes("seleccionar") && !text.includes("seleccione")) {
              firstValidIndex = i;
              break;
            }
          }
          if (firstValidIndex !== -1) {
            await dropdown.selectOption({ index: firstValidIndex });
            logger.info(`Selected Default/First available Oficina: ${opts[firstValidIndex].trim()}`);
            await page.waitForTimeout(1000);
          }
        };

        if (user.oficina && user.oficina !== "Cualquier oficina") {
          logger.info(`Attempting to select specific oficina: ${user.oficina}`);
          const normalizeStr = (str) =>
            str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
          const targetNormalized = normalizeStr(user.oficina);

          let matchIndex = -1;
          for (let i = 0; i < options.length; i++) {
            if (normalizeStr(options[i]).includes(targetNormalized)) {
              matchIndex = i;
              break;
            }
          }

          if (matchIndex !== -1) {
            await oficinaDropdown.selectOption({ index: matchIndex });
            logger.info(`Selected specific Oficina: ${options[matchIndex].trim()}`);
            await page.waitForTimeout(1000); // Give DOM a brief moment to process the selection change
          } else {
            logger.warn(`Oficina '${user.oficina}' not found. Selecting first valid option.`);
            await selectFirstValidOficina(oficinaDropdown, options);
          }
        } else {
          await selectFirstValidOficina(oficinaDropdown, options);
        }
      } else {
        logger.info("No Oficina dropdown found on acCitar page, skipping selection.");
      }

      // Click Siguiente button
      logger.info("Clicking Siguiente button...");
      await safeClick(
        page,
        "#btnSiguiente, input[value='Siguiente']",
        "Siguiente Button",
        false
      );

      // Wait for Contact page to load
      logger.info("Waiting for Contact Details page to load...");
      await page.waitForSelector('input[name="txtTelefono"], input[type="tel"]', {
        state: "visible",
        timeout: 15000,
      });
    } else {
      logger.info("Already on Contact Details page. Skipping Office selection.");
    }

    logger.info("Proceeding to Contact Details...");

    // =====================================
    // STEP 9
    // INFORMACIÓN COMPLEMENTARIA
    // =====================================
    logger.info("=== STEP 9: CONTACT DETAILS ===");

    // Final check for contact form
    await page.waitForSelector('input[name="txtTelefono"], input[type="tel"]', {
      timeout: 15000,
    });
    logger.info("Contact Details Form Ready");

    await page.locator('input[name="txtTelefono"], input[type="tel"]').first().waitFor({ state: "visible", timeout: 5000 });

    // Fill Phone
    const phoneInput = page
      .locator('input[name="txtTelefono"], input[type="tel"]')
      .first();
    if ((await phoneInput.count()) > 0) {
      await typeHumanized(page, phoneInput, user.phone);
      const val = await phoneInput.inputValue().catch(() => "");
      if (!val) throw new Error("Failed to fill Phone");
      logger.info(`Phone Filled: ${user.phone}`);
    }

    // Fill Email
    const emailInput = page
      .locator('input[name="emailDESC"], input[type="email"]')
      .first();
    if ((await emailInput.count()) > 0) {
      await typeHumanized(page, emailInput, user.email);
      const val = await emailInput.inputValue().catch(() => "");
      if (!val) throw new Error("Failed to fill Email");
      logger.info(`Email Filled: ${user.email}`);
    }

    // Fill Repeat Email
    const repeatEmailInput = page
      .locator(
        'input[name="emailRepeatDESC"], input[name="emailConfirmDESC"], input[name="repiteEmailDESC"]',
      )
      .first();
    if ((await repeatEmailInput.count()) > 0) {
      await typeHumanized(page, repeatEmailInput, user.email);
      const val = await repeatEmailInput.inputValue().catch(() => "");
      if (!val) throw new Error("Failed to fill Repeat Email");
      logger.info(`Repeat Email Filled: ${user.email}`);
    } else {
      // Fallback: finding the second email input field if ID is unknown
      const secondEmailInput = page.locator('input[type="email"]').nth(1);
      if ((await secondEmailInput.count()) > 0) {
        await typeHumanized(page, secondEmailInput, user.email);
        const val = await secondEmailInput.inputValue().catch(() => "");
        if (!val) throw new Error("Failed to fill Repeat Email (Fallback)");
        logger.info(`Repeat Email (Fallback) Filled: ${user.email}`);
      }
    }

    // Fill Motivo (Textarea)
    const motivoTextarea = page
      .locator('textarea[name="txtDesMotivo"], textarea')
      .first();
    if ((await motivoTextarea.count()) > 0) {
      await typeHumanized(page, motivoTextarea, user.tramite || "Solicitud de cita para Extranjeria");
      const val = await motivoTextarea.inputValue().catch(() => "");
      if (!val) throw new Error("Failed to fill Motivo Textarea");
      logger.info("Motivo Textarea Filled");
    }

    // Click Siguiente
    const btnSiguienteFinal = page
      .locator("#btnSiguiente, input[value='Siguiente']")
      .first();
    if ((await btnSiguienteFinal.count()) > 0) {      logger.info(
        "Applying 1-second delay to bypass WAF bot detection before clicking Siguiente...",
      );
      await page.waitForTimeout(1000);

      // Handle case where some Tramites ask for Passport/Name AGAIN on the Contact Form
      const extraContactFields = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        return inputs.map(input => {
           let labelText = "";
           if (input.id) {
             const labelEl = document.querySelector(`label[for="${input.id}"]`);
             if (labelEl) labelText = labelEl.innerText.trim().toLowerCase();
           }
           if (!labelText && input.parentElement) {
             labelText = input.parentElement.innerText.trim().toLowerCase();
           }
           return { id: input.id, label: labelText };
        });
      });

      for (const field of extraContactFields) {
        if (!field.id) continue;
        const selector = `#${field.id}`;
        const label = field.label;
        
        if (label.includes("documento") || label.includes("pasaporte") || label.includes("n.i.e") || label.includes("d.n.i")) {
          const val = await page.$eval(selector, el => el.value).catch(() => "");
          if (!val) {
             logger.info("Found empty Document field on Contact Page. Filling...");
             await typeHumanized(page, selector, user.passport);
          }
        } else if (label.includes("nombre") || label.includes("apellidos")) {
          const val = await page.$eval(selector, el => el.value).catch(() => "");
          if (!val) {
             logger.info("Found empty Name field on Contact Page. Filling...");
             let sanitizedName = user.name.replace(/[0-9]/g, "").replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, "").trim();
             if (!sanitizedName) sanitizedName = user.name;
             await typeHumanized(page, selector, sanitizedName);
          }
        }
      }

      await safeClick(
        page,
        "#btnSiguiente, input[value='Siguiente']",
        "Siguiente Button (Contact Form)",
        false,
      );

      logger.info(
        "Checking if route is successful. Waiting up to 30 seconds...",
      );
      let routed = false;
      for (let t = 1; t <= 30; t++) {
        await page.waitForTimeout(1000);
        logger.info(`Route Check Timer: ${t}s...`);
        const isRouted = await page
          .evaluate(() => {
            const hasAppointments =
              document.querySelectorAll(
                'input[name="idCita"], input[type="radio"], select, #imgCaptcha, img[alt="captcha"], input#txtFecha',
              ).length > 0;
            const hasNoCitas =
              document.body && (
                document.body.innerText.includes("No hay citas") ||
                document.body.innerText.includes("no hay citas") ||
                document.body.innerText.includes("no existen citas")
              );
            return hasAppointments || hasNoCitas;
          })
          .catch(() => false);
        if (isRouted) {
          routed = true;
          logger.info("Route successful! Proceeding to next page.");
          break;
        }
      }

      if (!routed)
        throw new Error(
          "Route did not change after submitting Contact Form. Forcing reload.",
        );
    }

    logger.info("Proceeding to Appointment Selection...");

    try {
      // =====================================
      // STEP 10
      // SELECCIONAR CITA (Calendar/Time)
      // =====================================

    let selectionSuccess = false;
    let directSuccess = false;
    let failureReason = "";

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          logger.info(`Slot Selection & Captcha Attempt ${attempt}/5...`);

          const loadStatusInner = await Promise.race([
            page.waitForSelector('input[type="radio"], input#txtFecha, select, #imgCaptcha, img[alt="captcha"]', { state: "visible", timeout: 5000 }).then(() => "loaded"),
            page.waitForSelector('text="No hay citas", text="no hay citas", text="no existen citas"', { state: "visible", timeout: 5000 }).then(() => "no_appointments"),
          ]).catch(() => "timeout");

          if (loadStatusInner === "no_appointments") {
            logger.info("Slots vanished in inner attempt. Exiting inner loop.");
            failureReason = "No appointments available";
            break;
          }

          // Wait for page stabilization and dynamic JS to bind
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

        // DUMP HTML FOR INSPECTION - Disabled in production

        // Parallel Optimization: Start capturing and solving Captcha in the background immediately
        let captchaPromise = null;
        const captchaImageLocator = page.locator('img[alt="captcha"], img.img-thumbnail, #imgCaptcha').first();
        const captchaInputLocator = page.locator('#txtCaptcha:visible, input[name*="captcha"]:visible, input[id*="captcha"]:visible, input[placeholder*="texto"]:visible, input[placeholder*="Captcha"]:visible').first();

        if (await captchaImageLocator.count().catch(() => 0) > 0 && await captchaInputLocator.count().catch(() => 0) > 0) {
          logger.info("🚀 [LATENCY OPTIMIZATION]: Starting parallel background Captcha solving...");
          captchaPromise = (async () => {
            try {
              const rawBuffer = await captchaImageLocator.screenshot({ timeout: 10000 });
              if (global.automationStats) {
                global.automationStats.captchaAttempts++;
              }
              const solvedText = await solveCaptcha(page, rawBuffer);
              return solvedText;
            } catch (err) {
              logger.error(`Parallel Captcha solver failed: ${err.message}`);
              return "";
            }
          })();
        }

        // Detect which layout is active
        const radioSelector = 'input[type="radio"][name="rdbCita"], input[type="radio"]';
        const radioCount = await page.locator(radioSelector).count().catch(() => 0);
        const gridLinkCount = await page.locator('a[id^="HUECO"], a:has-text("LIBRE")').count().catch(() => 0);

        if (radioCount > 0) {
          logger.info(`[LAYOUT A]: Found ${radioCount} Cita radio buttons. Executing Radio Button flow...`);
          
          const firstRadio = page.locator(radioSelector).first();
          
          // Use safeClick with coordinates click to bypass WAF
          await safeClick(page, 'input[type="radio"][name="rdbCita"], input[type="radio"]', "First available Cita Radio Button", false);
          
          // Force change event dispatch
          await firstRadio.evaluate((node) => {
            node.dispatchEvent(new Event("change", { bubbles: true }));
          });
          logger.info("Cita radio button checked.");

          // Wait for AJAX update - wait for select to be loaded/updated
          logger.info("Waiting for time dropdown to load/update after radio selection...");
          await page.waitForFunction((selectSel) => {
            const el = document.querySelector(selectSel);
            return el && !el.disabled && el.options.length > 1;
          }, 'select', { timeout: 5000 }).catch(() => {
            logger.warn("Time dropdown did not update options after radio selection.");
          });
          await page.waitForTimeout(500);

          // Leaving search query parameters (txtHora and txtFecha) completely untouched,
          // exactly matching a manual user who just clicks the radio button and submits.
          logger.info("Leaving search parameters (txtHora and txtFecha) untouched at their native defaults to match manual flow.");          // 4. Await and Fill Captcha
          if (captchaPromise) {
            logger.info("Waiting for background Captcha solving result...");
            const solvedText = await captchaPromise;
            if (solvedText && (await captchaInputLocator.count().catch(() => 0) > 0)) {
              // Use humanized typing to bypass WAF detection
              logger.info(`Filling Captcha input with humanized typing: "${solvedText}"`);
              await typeHumanized(page, captchaInputLocator, solvedText);
              await page.waitForTimeout(200);
            } else {
              throw new Error("Captcha solving failed or returned empty. Aborting submission to retry solving.");
            }
          }

          // 5. Click Siguiente
          logger.info("Clicking Siguiente on slot selection page...");
          await safeClick(
            page,
            "#btnSiguiente, input[value='Siguiente'], input[name='btnSiguiente']",
            "Siguiente Button",
            false
          );
        } else if (gridLinkCount > 0) {
          logger.info(`[LAYOUT B]: Found ${gridLinkCount} grid links. Executing Table Matrix flow...`);          // 1. Solve CAPTCHA first, because it must be filled before clicking the slot link
          if (captchaPromise) {
            logger.info("Waiting for background Captcha solving result...");
            const solvedText = await captchaPromise;
            if (solvedText && (await captchaInputLocator.count().catch(() => 0) > 0)) {
              // Use humanized typing to bypass WAF detection
              logger.info(`Filling Captcha input with humanized typing: "${solvedText}"`);
              await typeHumanized(page, captchaInputLocator, solvedText);
              await page.waitForTimeout(200);
            } else {
              throw new Error("Captcha solving failed or returned empty. Aborting slot click to retry solving.");
            }
          }

          // 2. Select matching slot ID from browser context dynamically
          const targetSlotData = await page.evaluate(({ prefDate, prefTime }) => {
            // Find all date headers in table (format: DD/MM/YYYY)
            const ths = Array.from(document.querySelectorAll('table th'));
            const dateHeaders = [];
            ths.forEach(th => {
              const text = th.textContent.trim();
              if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
                dateHeaders.push(text);
              }
            });

            // Find all rows containing times
            const trs = Array.from(document.querySelectorAll('table tr'));
            const availableSlots = [];

            trs.forEach(tr => {
              const th = tr.querySelector('th');
              if (!th) return;
              const rowTime = th.textContent.trim();
              if (!/^\d{2}:\d{2}$/.test(rowTime)) return;

              // Find all cells (td) in the row
              const tds = Array.from(tr.querySelectorAll('td'));
              tds.forEach(td => {
                const link = td.querySelector('a');
                if (link && link.textContent.trim().toUpperCase() === 'LIBRE') {
                  let dateIndex = -1;
                  const classes = Array.from(td.classList);
                  classes.forEach(cls => {
                    const match = cls.match(/colFecha(\d+)/i);
                    if (match) {
                      dateIndex = parseInt(match[1], 10);
                    }
                  });

                  if (dateIndex !== -1 && dateIndex < dateHeaders.length) {
                    availableSlots.push({
                      id: link.id,
                      date: dateHeaders[dateIndex],
                      time: rowTime
                    });
                  }
                }
              });
            });

            if (availableSlots.length === 0) return null;

            // Format prefDate from YYYY-MM-DD to DD/MM/YYYY
            let targetDateStr = "";
            if (prefDate) {
              const parts = prefDate.split('-');
              if (parts.length === 3) {
                targetDateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
              }
            }

            let matchedSlot = null;

            // Try exact date & time match
            matchedSlot = availableSlots.find(s => {
              const dateMatch = targetDateStr ? s.date === targetDateStr : true;
              const timeMatch = prefTime ? s.time.includes(prefTime) : true;
              return dateMatch && timeMatch;
            });

            // Try matching only date
            if (!matchedSlot && targetDateStr) {
              matchedSlot = availableSlots.find(s => s.date === targetDateStr);
            }

            // Try matching only time
            if (!matchedSlot && prefTime) {
              matchedSlot = availableSlots.find(s => s.time.includes(prefTime));
            }

            // Fallback to first available
            if (!matchedSlot) {
              matchedSlot = availableSlots[0];
            }

            return matchedSlot ? { id: matchedSlot.id, date: matchedSlot.date } : null;
          }, { prefDate: user.preferredDate, prefTime: user.preferredTime }).catch(() => null);

          if (!targetSlotData) {
            throw new Error("No available Cita slots (LIBRE) could be selected from the table grid.");
          }

          logger.info(`Selected Slot Element ID to click: "${targetSlotData.id}", Date: ${targetSlotData.date}`);

          // Update the calendar date field programmatically to match the selected slot's date!
          if (targetSlotData.date) {
            const dateInput = page.locator('#fechaSeleccionada, input[name="txtFecha"], input#txtFecha, input[class*="datepicker"]').first();
            if (await dateInput.count().catch(() => 0) > 0) {
              logger.info(`Updating calendar field programmatically (without mutating attributes) to: ${targetSlotData.date}`);
              await dateInput.evaluate((el, d) => {
                el.value = d;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("blur", { bubbles: true }));
              }, targetSlotData.date).catch(() => {});
            }
          }

          // 3. Click the slot link
          await safeClick(page, `#${targetSlotData.id}`, "Cita Slot Link (LIBRE)", false);
        } else {
          // Check if "No appointments" text is visible
          const noCitasTextVisible = await page.evaluate(() => {
            const text = document.body ? document.body.innerText : "";
            return text.includes("No hay citas") || text.includes("no hay citas") || text.includes("no existen citas");
          }).catch(() => false);

          if (noCitasTextVisible) {
            logger.info("Step 10: 'No appointments available' message detected. Exiting flow.");
            failureReason = "No appointments available";
            break;
          } else {
            throw new Error("Neither Radio Button nor Table Grid Cita layout could be identified on Step 10.");
          }
        }

        // 6. Handle jQuery Confirm Dialog (Common to both layouts after submission/slot-clicking)
        logger.info("Checking if jQuery confirmation popup appeared...");
        const confirmBtnSelector = '.jconfirm-buttons button';
        try {
          // Wait up to 5 seconds for the confirmation popup to appear
          await page.waitForSelector(confirmBtnSelector, { state: 'visible', timeout: 5000 });
          logger.info("Confirmation popup detected. Handling...");

          // Humanize: Sleep between 1.5 to 2.5 seconds to simulate reading the popup
          const sleepTime = Math.floor(Math.random() * 1000) + 1500;
          logger.info(`Applying humanized popup reading delay of ${sleepTime}ms before clicking...`);
          await page.waitForTimeout(sleepTime);


          // Add a temporary unique class to the button in browser context so we can use standard CSS selector with safeClick
          const targetSelector = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('.jconfirm-buttons button'));
            let targetBtn = null;
            for (let btn of buttons) {
              const text = btn.textContent.trim();
              if (text.includes("Sí") || text.includes("SI") || text.includes("SÍ") || text.toLowerCase().includes("aceptar") || text.toLowerCase().includes("confirmar")) {
                targetBtn = btn;
                break;
              }
            }
            if (!targetBtn && buttons.length > 0) {
              targetBtn = buttons[0];
            }
            if (targetBtn) {
              targetBtn.classList.add('temp-confirm-click-target');
              return '.temp-confirm-click-target';
            }
            return null;
          }).catch(() => null);

          if (targetSelector) {
            logger.info(`Clicking confirmation button via safeClick with selector: "${targetSelector}"`);
            await safeClick(page, targetSelector, "Confirmation Dialog Yes Button", false);
          } else {
            logger.warn("No confirmation button could be identified in the DOM.");
          }
        } catch (e) {
          logger.info("No jQuery confirmation popup appeared within timeout (or already handled).");
        }

        // Wait up to 10 seconds to check if we routed to SMS Verification page OR Confirmation page
        let pageState = "none";
        for (let t = 1; t <= 10; t++) {
          await page.waitForTimeout(1000);
          const detectedState = await page.evaluate(() => {
            const hasCheckboxes = document.querySelectorAll('input[type="checkbox"]').length > 0;
            const hasSuccess = document.querySelector('#btnImprimir') || 
                              (document.body && (
                                document.body.innerText.includes("Justificante") ||
                                document.body.innerText.includes("imprimir") ||
                                document.body.innerText.includes("confirmada")
                              ));
            if (hasCheckboxes) return "otp";
            if (hasSuccess) return "success";
            return "none";
          }).catch(() => "none");
          
          if (detectedState !== "none") {
            pageState = detectedState;
            break;
          }
        }

        if (pageState === "otp") {
          logger.info("Successfully navigated to SMS Verification page!");
          if (global.automationStats) {
            global.automationStats.captchaSuccess++;
          }
          selectionSuccess = true;
          break;
        } else if (pageState === "success") {
          logger.info("🎉 Booking completed directly! Navigation to Confirmation page successful (No OTP required).");
          if (global.automationStats) {
            global.automationStats.captchaSuccess++;
          }
          selectionSuccess = true;
          directSuccess = true;
          break;
        } else {
          // Log any error text visible on the page
          const errorMsg = await page.evaluate(() => {
            const elements = document.querySelectorAll(
              '.mf-msg__info, .error-message, [style*="color: red"], [style*="color:red"], span[class*="error"], div[class*="error"]'
            );
            for (let el of elements) {
              const txt = el.innerText.trim();
              if (txt) return txt;
            }
            return null;
          }).catch(() => null);

          if (errorMsg) {
            logger.warn(`Slot selection page error detected: "${errorMsg}"`);
            if (errorMsg.includes("coincide con el de la imagen") || errorMsg.toLowerCase().includes("captcha")) {
              logger.warn("Captcha was incorrect. Retrying slot selection with a new Captcha...");
            } else {
              logger.warn(`Non-captcha error: "${errorMsg}". Retrying...`);
            }
          } else {
            logger.warn("Navigation to SMS verification page failed. Retrying slot selection...");
          }
        }
      } catch (err) {
        logger.error(`Error in Slot/Captcha selection loop: ${err.message}`);
      }
      }

    if (!selectionSuccess) {
      return {
        success: false,
        reason: failureReason || "Failed to select slots after multiple attempts"
      };
    }

      // =====================================
      // STEP 11
      // SMS VERIFICATION PAGE
      // =====================================

      if (!directSuccess) {
        logger.info("Waiting for Verification Page...");
        await page.waitForSelector('input[type="checkbox"]', {
          state: "visible",
          timeout: 35000,
        });
        logger.info("Verification Page Loaded.");

        // Check all consent checkboxes automatically
        const checkboxes = page.locator('input[type="checkbox"]');
        const count = await checkboxes.count();
        for (let i = 0; i < count; i++) {
          await checkboxes.nth(i).check({ force: true });
        }
        logger.info(`Checked ${count} consent checkboxes automatically.`);

        // Check if there is an OTP input on the page
        const otpInputSelector = 'input[name*="Codigo"], input[name*="codigo"], input[id*="Codigo"], input[id*="codigo"]';
        const hasOtpInput = (await page.locator(otpInputSelector).count().catch(() => 0)) > 0;

        if (hasOtpInput) {
          // Poll database for OTP code from client webhook
          logger.info("[OTP] Polling database for incoming SMS code from webhook...");
          let otpCode = "";
          const startTime = Date.now();
          const timeoutMs = 180000; // 3 minutes timeout

          while (Date.now() - startTime < timeoutMs) {
            if (page.isClosed()) {
              throw new Error("Target page, context or browser has been closed while waiting for OTP");
            }
            const freshJob = await Job.findById(user.jobId).catch(() => null);
            if (freshJob && freshJob.otpCode) {
              otpCode = freshJob.otpCode.trim();
              // Reset otpCode in database to prevent re-use
              freshJob.otpCode = "";
              await freshJob.save().catch(() => {});
              break;
            }
            await page.waitForTimeout(1000); // Poll every 1 second
          }

          if (otpCode) {
            logger.info(`[OTP] Found OTP Code: "${otpCode}". Filling into form...`);
            
            // Wait for OTP input to be ready
            await page.waitForSelector(otpInputSelector, { state: 'visible', timeout: 5000 }).catch(() => {});
            
            const otpInput = page.locator(otpInputSelector).first();
            if (await otpInput.count() > 0) {
              await typeHumanized(page, otpInput, otpCode);
              await page.waitForTimeout(500);

              // Click Confirmar
              logger.info("[OTP] Clicking Confirmar button to complete booking...");
              const submitBtnSelector = '#btnConfirmar, #btnAceptar, input[value*="Confirmar" i], input[value*="Aceptar" i], button[type="submit"]';
              await safeClick(page, submitBtnSelector, "Confirmar Button", false);
              
              // Wait up to 15 seconds for print button or success message
              logger.info("Waiting for booking confirmation details to load...");
              const successDetected = await page.waitForFunction(() => {
                const text = document.body ? document.body.innerText : "";
                return document.querySelector('#btnImprimir') || text.includes("imprimir") || text.includes("Justificante") || text.includes("confirmada");
              }, { timeout: 15000 }).then(() => true).catch(() => false);

              if (successDetected) {
                logger.info("🎉 Booking completed successfully! Confirmation page loaded.");
                selectionSuccess = true;
              } else {
                logger.warn("Booking confirmation page did not load immediately. Please check browser window.");
              }
            } else {
              logger.warn("OTP input element not found on page.");
            }
          } else {
            logger.warn("[OTP] Timeout waiting for OTP code from client webhook.");
            throw new Error("Timeout waiting for SMS verification OTP code");
          }
        } else {
          // No OTP input field on the page! Just click Confirmar directly
          logger.info("[OTP] No OTP input field detected on verification page. Proceeding to click Confirmar directly...");
          const submitBtnSelector = '#btnConfirmar, #btnAceptar, input[value*="Confirmar" i], input[value*="Aceptar" i], button[type="submit"]';
          await safeClick(page, submitBtnSelector, "Confirmar Button", false);

          // Wait up to 15 seconds for print button or success message
          logger.info("Waiting for booking confirmation details to load...");
          const successDetected = await page.waitForFunction(() => {
            const text = document.body ? document.body.innerText : "";
            return document.querySelector('#btnImprimir') || text.includes("imprimir") || text.includes("Justificante") || text.includes("confirmada");
          }, { timeout: 15000 }).then(() => true).catch(() => false);

          if (successDetected) {
            logger.info("🎉 Booking completed successfully! Confirmation page loaded (Direct booking without OTP).");
            selectionSuccess = true;
          } else {
            logger.warn("Booking confirmation page did not load immediately. Please check browser window.");
          }
        }
    } else {
      logger.info("🎉 Skipping SMS Verification since booking was completed directly.");
    }

      return { success: true };
    } catch (err) {
      logger.error(
        `Error during Appointment Selection or Verification: ${err.message}`,
      );
      throw err;
    }
  } catch (err) {
    const errMsg = err.message || "";
    const isCleanTransient = 
      errMsg.includes("WAF Blocked") ||
      errMsg.includes("Session corrupted") ||
      errMsg.toLowerCase().includes("closed") ||
      errMsg.toLowerCase().includes("cdpconnection");

    if (isCleanTransient) {
      logger.warn(`ICP Booking Flow aborted cleanly: ${errMsg}`);
    } else {
      logger.error(`ICP Booking Error: ${errMsg}`);
      logger.error(err.stack);
    }

    // Propagate the error so the orchestrator can catch 403 Forbidden and instant-retry
    throw err;
  }
}

module.exports = icpBookingFlow;

