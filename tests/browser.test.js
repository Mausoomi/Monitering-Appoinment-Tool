const { chromium } = require("playwright");
const http = require("http");
const net = require("net");
require("dotenv").config();

// Local Forwarding Proxy Tunnel Server to bypass ERR_PROXY_AUTH_UNSUPPORTED
function startLocalProxy(proxyPort) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Local HTTP Tunnel is running.');
    });

    server.on('connect', (req, clientSocket, head) => {
      // DataImpulse proxies require a session suffix (e.g. ;sessid.xxx) to authenticate successfully
      const rawUser = process.env.PROXY_USERNAME || "1962208cecad8c996178__cr.es";
      const proxyUser = rawUser.includes("sessid") ? rawUser : `${rawUser};sessid.manualbrowser123`;
      const proxyPass = process.env.PROXY_PASSWORD || "e75c411059ffebde";
      const authHeader = Buffer.from(`${proxyUser}:${proxyPass}`).toString('base64');
      
      const proxySocket = net.connect(823, "gw.dataimpulse.com", () => {
        proxySocket.write(`CONNECT ${req.url} HTTP/1.1\r\nProxy-Authorization: Basic ${authHeader}\r\n\r\n`);
        proxySocket.write(head);
        proxySocket.pipe(clientSocket);
        clientSocket.pipe(proxySocket);
      });
      
      proxySocket.on('error', () => clientSocket.end());
      clientSocket.on('error', () => proxySocket.end());
    });

    server.listen(proxyPort, '127.0.0.1', () => {
      console.log(`[BROWSER CONFIG] Local forwarding proxy running at http://127.0.0.1:${proxyPort}`);
      resolve(server);
    });

    server.on('error', reject);
  });
}

(async () => {
  console.log("==========================================");
  console.log("Launching automated proxy-guided Chrome...");
  console.log("Proxy Tunnel: gw.dataimpulse.com:823");
  console.log("==========================================");

  const localProxyPort = 64115;
  const proxyServerInstance = await startLocalProxy(localProxyPort);

  const browser = await chromium.launch({
    headless: false,
    args: [
      `--proxy-server=http://127.0.0.1:${localProxyPort}`,
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-networking",
      "--no-ping"
    ]
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    recordHar: {
      path: "C:\\Users\\dev24\\Desktop\\mayank folder\\Appointment-Slot-Monitoring-Tool\\tests\\recording.har",
      mode: "full",
      content: "embed"
    }
  });  // Advanced WAF stealth configurations to bypass F5 and Dynatrace blocking
  await context.addInitScript(() => {
    try {
      delete Object.getPrototypeOf(navigator).webdriver;
    } catch (e) {}

    try {
      const filterKeys = (keys) => keys.filter(k => typeof k !== 'string' || (!k.includes('cdc_') && !k.includes('playwright')));
      
      const origGetOwnPropertyNames = Object.getOwnPropertyNames;
      Object.getOwnPropertyNames = function(obj) {
        const names = origGetOwnPropertyNames.apply(this, arguments);
        if (obj === window) {
          return filterKeys(names);
        }
        return names;
      };
      
      const origKeys = Object.keys;
      Object.keys = function(obj) {
        const keys = origKeys.apply(this, arguments);
        if (obj === window) {
          return filterKeys(keys);
        }
        return keys;
      };
      
      const origReflectKeys = Reflect.ownKeys;
      Reflect.ownKeys = function(target) {
        const keys = origReflectKeys.apply(this, arguments);
        if (target === window) {
          return filterKeys(keys);
        }
        return keys;
      };
    } catch (e) {}
  });

  const page = await context.newPage();
  
  console.log("Navigating to Extranjeria portal...");
  await page.goto("https://icp.administracionelectronica.gob.es/icpplus/");
  
  console.log("\n[SUCCESS] Browser is ready! You can manually perform actions now.");
  console.log("Please do not close this terminal window until you are done.");// Wait for user to press ENTER in terminal to cleanly save and exit
  console.log("\n[SUCCESS] Browser is ready! You can manually perform actions now.");
  console.log("----------------------------------------------------------------------");
  console.log("👉 IMPORTANT: DO NOT close the browser window manually!");
  console.log("👉 When you are done, press ENTER in this terminal to save the HAR and exit...");
  console.log("----------------------------------------------------------------------");

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question("", async () => {
    console.log("Saving HAR file and exiting script cleanly...");
    try {
      await context.close();
      await browser.close();
      proxyServerInstance.close();
      console.log("HAR file successfully flushed and saved to tests/recording.har!");
    } catch (e) {
      console.error("Error closing browser cleanly:", e.message);
    }
    rl.close();
    process.exit(0);
  });
})();
