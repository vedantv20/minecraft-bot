require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// Use temp directory for cookies in containerized environment
const COOKIE_PATH =
  process.env.NODE_ENV === "production"
    ? path.resolve("/tmp/puppeteer_cookies", "cookies.json")
    : path.resolve(__dirname, "cookies.json");

let browser = null;
let page = null;
const serverInfo = { status: "unknown", success: false };

async function initiateServer() {
  try {
    const loginStatus = await logInToAternos();
    if (!loginStatus) throw new Error("Login failed");

    const serverResponse = await navigateToServer();
    if (!serverResponse || !serverResponse.success) {
      throw new Error("Failed to navigate to server");
    }
    const serverStatus = await handleServerStatus();
    console.log("Final server status:", serverStatus);
    return { success: true, status: serverStatus };
  } catch (error) {
    console.error(`Server initiation failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await cleanup();
  }
}

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
      console.log("Browser closed");
    } catch (err) {
      console.error("Error closing browser:", err);
    }
    browser = null;
    page = null;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getCurrentStatus() {
  try {
    await page.waitForSelector(".statuslabel-label", { timeout: 30000 });

    const currentStatus = await page.$eval(".statuslabel-label", (el) =>
      el.textContent.trim().toLowerCase()
    );

    const waitingPhases = ["loading", "saving", "stopping"];
    const isInWaitingPhase = waitingPhases.some((phase) =>
      currentStatus.includes(phase)
    );

    if (isInWaitingPhase) {
      console.log(`Server is ${currentStatus}, waiting 5 seconds...`);
      await delay(5000);

      // Check if page is still valid before proceeding
      if (!page.isClosed()) {
        const statusAfterDelay = await page.$eval(".statuslabel-label", (el) =>
          el.textContent.trim().toLowerCase()
        );

        // Only recursively check if status unchanged
        if (statusAfterDelay === currentStatus) {
          return await getCurrentStatus();
        }
        return statusAfterDelay;
      }
    }
    return currentStatus;
  } catch (err) {
    console.error(`Error getting current status: ${err.message}`);
    if (err.message.includes("detached") || err.message.includes("closed")) {
      throw new Error("Page detached or closed");
    }
    return "unknown";
  }
}

async function logInToAternos() {
  const { ATERNOS_USERNAME, ATERNOS_PASSWORD } = process.env;
  if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD) {
    throw new Error("Missing Aternos credentials in environment variables");
  }

  console.log("Launching browser...");

  browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-zygote",
    ],
    headless: true,
    ignoreHTTPSErrors: true,
    timeout: 90000,
  });

  page = await browser.newPage();
  await page.setDefaultNavigationTimeout(60000);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
  );

  // Create directory for cookies if it doesn't exist
  const cookieDir = path.dirname(COOKIE_PATH);
  if (!fs.existsSync(cookieDir)) {
    fs.mkdirSync(cookieDir, { recursive: true });
  }

  if (fs.existsSync(COOKIE_PATH)) {
    let cookies;
    try {
      cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
      await page.setCookie(...cookies);
    } catch (e) {
      console.warn(
        "Error setting cookies - falling back to full login:",
        e.message
      );
      return await fullLogin();
    }
    try {
      await page.goto("https://aternos.org/servers/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (e) {
      console.warn("Navigation error:", e.message);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    }

    try {
      await page.waitForSelector(".server-name", { timeout: 10000 });
      console.log("Logged in using cookies");
      return true;
    } catch {
      console.log(
        "Cookie login failed (selector not found), falling back to full login"
      );
      try {
        fs.unlinkSync(COOKIE_PATH);
      } catch (err) {
        console.warn("Could not delete cookie file:", err.message);
      }
    }
  }
  // perform full login if cookies did not work
  return await fullLogin();

  async function fullLogin() {
    console.log("Performing full login");
    try {
      await page.goto("https://aternos.org/go/", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      await page.waitForSelector(".username", { timeout: 10000 });
      await page.type(".username", ATERNOS_USERNAME);

      await page.waitForSelector(".password", { timeout: 10000 });
      await page.type(".password", ATERNOS_PASSWORD);

      await Promise.all([
        page.click(".login-button"),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
      ]);

      if (page.url().includes("go/?login")) {
        console.error("Login failed: bad credentials or captcha");
        return false;
      }

      const newCookies = await page.cookies();
      fs.writeFileSync(COOKIE_PATH, JSON.stringify(newCookies, null, 2));
      console.log("Cookies saved for future sessions!");
      return true;
    } catch (err) {
      console.error("Full login process failed:", err);
      return false;
    }
  }
}

async function navigateToServer() {
  console.log("navigating to the servers page");
  try {
    await page.goto("https://aternos.org/servers/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(".server-body", { timeout: 30000 });
    const server = await page.$(".server-body");
    if (!server) throw new Error("No servers found");
    await server.click();
    console.log("clicked on the server");
    return { success: true, status: "successfully navigated to server" };
  } catch (err) {
    console.error(`Server navigation error: ${err.message}`);
    serverInfo.status = "navigation error";
    return { success: false, error: err.message };
  }
}

// Constants
const MAX_SERVER_ATTEMPTS = 10;
const MAX_QUEUE_CHECKS = 60;

async function handleServerStatus() {
  let attempts = 0;
  while (attempts < MAX_SERVER_ATTEMPTS) {
    attempts++;
    try {
      if (page.isClosed()) {
        throw new Error("Page is closed");
      }
      const status = await getCurrentStatus();
      console.log(
        `Checking server status (Attempt ${attempts}/${MAX_SERVER_ATTEMPTS}):`,
        status
      );

      if (status === "online") {
        console.log("🎉 Server is ONLINE!");
        return { success: true, status };
      }

      if (status === "offline") {
        console.log("Starting server");
        const startButton = await page.$("#start");
        if (startButton) {
          await startButton.click();
          await delay(5000);
          const newStatus = await getCurrentStatus();
          console.log("Post-start status:", newStatus);
        } else {
          console.log("Start button not found");
        }
      }

      const currentStatus = await getCurrentStatus();
      const isStartingPhase = [
        "loading",
        "starting",
        "saving",
        "preparing",
      ].some((phase) => currentStatus.includes(phase));

      if (isStartingPhase) {
        console.log("Monitoring starting phase...");
        const phaseResult = await monitorStartingPhase();
        if (phaseResult === "online") continue;
      }

      const isWaitingPhase = ["queue", "waiting"].some((phase) =>
        currentStatus.includes(phase)
      );
      if (isWaitingPhase) {
        const queueResult = await handleQueueProcess();
        console.log({ queueResult });
        if (queueResult === "online") continue;
      }

      await delay(10000);
    } catch (err) {
      console.log("Server status error:", err.message);

      // Try to recover if page is detached
      if (
        err.message.includes("detached") ||
        err.message.includes("closed") ||
        !page ||
        page.isClosed()
      ) {
        console.log("Attempting to recover from detached/closed page...");
        try {
          if (browser && !browser.isConnected()) {
            await cleanup();
            return { success: false, error: "Browser disconnected" };
          }

          // Try to create a new page if browser is still connected
          if (browser && browser.isConnected()) {
            page = await browser.newPage();
            await page.setDefaultNavigationTimeout(60000);
            await page.setUserAgent(
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
            );
            await navigateToServer();
          } else {
            throw new Error("Browser is not connected");
          }
        } catch (recoveryErr) {
          console.error("Recovery failed:", recoveryErr.message);
          return { success: false, error: "Recovery failed" };
        }
      }

      await delay(10000);
    }
  }

  throw new Error(`Failed after ${MAX_SERVER_ATTEMPTS} attempts`);
}

async function handleQueueProcess() {
  let checks = 0;
  let position = null;
  while (
    checks < MAX_QUEUE_CHECKS ||
    position < Infinity ||
    position === null
  ) {
    checks++;
    try {
      if (page.isClosed()) {
        throw new Error("Page is closed");
      }

      // Confirm button handling
      const confirmButtonExists = await page.evaluate(() => {
        const button = document.querySelector("#confirm");

        if (!button) return null;

        const style = window.getComputedStyle(button);
        return style.display === "flex";
      });

      if (confirmButtonExists) {
        const serverConfirmation = await confirmServerActiviation();
        if (serverConfirmation) {
          const result = await monitorStartingPhase();
          if (result === "online") return "online";
        }
      }

      console.log(`Queue check ${checks}/${MAX_QUEUE_CHECKS}`);
      const status = await getCurrentStatus();
      if (status === "online") return "online";
      if (status === "offline") return "offline";
      if (status.includes("preparing") || status.includes("starting")) {
        console.log("Transitioned from queue to preparing/starting phase");
        return status;
      }

      // Queue position handling
      try {
        const posText = await page
          .$eval(".queue-position", (el) => el.textContent)
          .catch(() => "0");
        position = parseInt(posText.match(/\d+/)?.[0]) || Infinity;

        console.log(`Queue position: ${position}`);

        if (position <= 1) {
          await confirmServerActiviation();
          const result = await monitorStartingPhase();
          if (result === "online") return "online";
        }
      } catch (posErr) {
        console.log("Error getting queue position:", posErr.message);
        position = Infinity;
      }

      // Dynamic waiting
      const waitTime = position <= 3000 ? 5000 : 15000;
      console.log(`Waiting ${waitTime / 1000}s...`);
      await delay(waitTime);
    } catch (err) {
      console.log("Queue error:", err.message);

      // Check if we need to recover from detached page
      if (err.message.includes("detached") || err.message.includes("closed")) {
        throw err; // Propagate to outer handler
      }

      await delay(10000);
    }
  }
  const finalStatus = await getCurrentStatus();
  if (
    finalStatus.includes("preparing") ||
    finalStatus.includes("starting") ||
    finalStatus === "online"
  ) {
    console.log(`Queue exited but server is in valid state: ${finalStatus}`);
    return finalStatus;
  }
  throw new Error(
    `Queue processing failed after ${MAX_QUEUE_CHECKS} checks at position ${position}`
  );
}

async function confirmServerActiviation() {
  try {
    // Check if page is still valid
    if (page.isClosed()) {
      throw new Error("Page is closed");
    }

    // Confirm button
    const confirmButton = await page.waitForSelector("#confirm", {
      timeout: 30000,
    });
    if (confirmButton) {
      await confirmButton.click();
      console.log("✅ Confirm button clicked");
      await delay(2000);
      return true;
    } else {
      console.log("Confirm button not found");
      return false;
    }
  } catch (err) {
    console.log("Activation failed:", err.message);
    return false;
  }
}

async function monitorStartingPhase() {
  try {
    // Check if page is still valid
    if (page.isClosed()) {
      throw new Error("Page is closed");
    }

    const status = await getCurrentStatus();
    console.log(`current status: ${status}`);
    serverInfo.status = status;

    if (status === "online") {
      console.log("🎉 Server is now ONLINE!");
      serverInfo.success = true;
      return "online";
    }
    if (status === "offline") {
      // Fixed typo: s -> status
      console.log("⚠️ Server went offline during preparing");
      return "offline";
    }

    await delay(10000);
    return serverInfo.status;
  } catch (err) {
    console.log("Error in monitoring phase:", err.message);
    throw err;
  }
}

module.exports = {
  initiateServer,
  logInToAternos,
  handleServerStatus,
  handleQueueProcess,
};
