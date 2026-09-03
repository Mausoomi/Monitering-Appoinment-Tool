const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

// Find Chrome Executable Path on Windows
function getChromePath() {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error('Google Chrome executable not found. Please install Chrome or verify its path.');
}

// Start local proxy tunnel
function startProxyTunnel(jobSession, port) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Local HTTP Tunnel is running.');
        });

        server.on('connect', (req, clientSocket, head) => {
            const proxyUser = `${process.env.PROXY_USERNAME};sessid.local${jobSession}`;
            const proxyPass = process.env.PROXY_PASSWORD;
            const authHeader = Buffer.from(`${proxyUser}:${proxyPass}`).toString('base64');
            let proxyHost = 'gw.dataimpulse.com';
            let proxyPort = 10000;
            if (process.env.PROXY_SERVER) {
                try {
                    const parsedUrl = new URL(process.env.PROXY_SERVER);
                    proxyHost = parsedUrl.hostname;
                    proxyPort = parseInt(parsedUrl.port || "10000", 10);
                } catch (e) {}
            }

            const proxySocket = net.connect(proxyPort, proxyHost, () => {
                proxySocket.write(`CONNECT ${req.url} HTTP/1.1\r\nProxy-Authorization: Basic ${authHeader}\r\n\r\n`);
                proxySocket.write(head);
                proxySocket.pipe(clientSocket);
                clientSocket.pipe(proxySocket);
            });
            proxySocket.on('error', () => clientSocket.end());
            clientSocket.on('error', () => proxySocket.end());
        });

        server.listen(port, '127.0.0.1', () => {
            console.log(`[BROWSER CONFIG] Local forwarding proxy running at http://127.0.0.1:${port}`);
            resolve(server);
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

// Wait for Chrome remote debugging port to become responsive
async function waitForChrome(port) {
    const url = `http://127.0.0.1:${port}/json/version`;
    for (let i = 0; i < 30; i++) {
        try {
            await new Promise((res, rej) => {
                const req = http.get(url, (response) => {
                    if (response.statusCode === 200) res();
                    else rej();
                });
                req.on('error', rej);
                req.end();
            });
            return;
        } catch (e) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error(`Timeout waiting for Chrome Remote Debugging on port ${port}`);
}

async function launchBrowser(jobSession, chromePort, proxyPort, windowX = 0, windowY = 0, windowWidth = 640, windowHeight = 480) {
    // 1. Start proxy tunnel
    const proxyServer = await startProxyTunnel(jobSession, proxyPort);

    // 2. Launch Chrome process using remote debugging
    const chromePath = getChromePath();
    const userDataDir = path.join(process.cwd(), 'Temp_Data', `chrome_debug_profile_${jobSession}`);    console.log(`[BROWSER CONFIG] Spawning clean Chrome at position (${windowX}, ${windowY}) with size ${windowWidth}x${windowHeight}`);
    const chromeProcess = spawn(chromePath, [
        `--remote-debugging-port=${chromePort}`,
        `--proxy-server=http://127.0.0.1:${proxyPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-networking',
        '--no-ping',
        `--window-size=${windowWidth},${windowHeight}`,
        `--window-position=${windowX},${windowY}`
    ], {
        detached: true,
        stdio: 'ignore'
    });
    chromeProcess.unref();

    // 3. Wait for Chrome Debugging Protocol to be ready
    await waitForChrome(chromePort);

    // 4. Attach Playwright via CDP
    console.log(`[BROWSER CONFIG] Connecting Playwright via CDP to port ${chromePort}...`);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${chromePort}`, {
        timeout: 120000
    });

    // 5. Cleanup hooks to prevent orphan processes
    const cleanUp = () => {
        if (chromeProcess) {
            try {
                chromeProcess.kill();
            } catch (e) {}
        }
        if (proxyServer) {
            try {
                proxyServer.close();
            } catch (e) {}
        }
    };

    browser.on('disconnected', cleanUp);

    return {
        browser,
        chromeProcess,
        proxyServer,
        userDataDir
    };
}

module.exports = launchBrowser;