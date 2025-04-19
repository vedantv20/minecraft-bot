require("dotenv/config");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const COOKIE_PATH = path.resolve(__dirname, "cookies.json");
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
  await page.waitForSelector(".statuslabel-label", { timeout: 30000 });

  const currentStatus = await page.$eval(".statuslabel-label", (el) =>
    el.textContent.trim().toLowerCase()
  );
  const waitingPhases = ["loading", "saving", "stopping"];
  const isInWaitingPhase = waitingPhases.some((phase) =>
    currentStatus.includes(phase)
  );

  while (isInWaitingPhase) {
    console.log(`Server is ${currentStatus}, waiting 5 seconds...`);
    await delay(5000);
    const statusAfterDelay = await page.$eval(".statuslabel-label", (el) =>
      el.textContent.trim().toLowerCase()
    );

    // repeat status check if the staus was unchanged.
    if (statusAfterDelay === currentStatus) getCurrentStatus();
  }
  return currentStatus;
}

async function logInToAternos() {
  const { ATERNOS_USERNAME, ATERNOS_PASSWORD } = process.env;
  if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD) {
    throw new Error("Missing Aternos credentials in environment variables");
  }

  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--window-size=1920,1080",
    ],
    defaultViewport: { width: 1920, height: 1080 },
    executablePath: puppeteer.executablePath(),
  });
  page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
  );
  if (fs.existsSync(COOKIE_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
      await page.setCookie(...cookies);
      await page.goto("https://aternos.org/servers/", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      if (await page.$(".server-name")) {
        console.log("Logged in using cookies");
        return true;
      }
      console.log("⚠️⚠️⚠️ Saved cookies invalid, falling back to login");
      // fs.unlinkSync(COOKIE_PATH);
    } catch (err) {
      console.warn("Error using saved cookies:", err.message);
      // fs.unlinkSync(COOKIE_PATH);
    }
  }

  console.log("✍️ Performing full login");
  await page.goto("https://aternos.org/go/", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await page.type(".username", ATERNOS_USERNAME);
  await page.type(".password", ATERNOS_PASSWORD);

  await Promise.all([
    page.click(".login-button"),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
  ]);

  if (page.url().includes("go/?login")) {
    console.error("Login failed bad credentials or captcha");
    return false;
  }

  const freshCookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(freshCookies, null, 2));
  console.log("Cookies saved for future sessions!");
  return true;
}

async function navigateToServer() {
  try {
    await page.goto("https://aternos.org/servers/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await page.waitForSelector(".server-body", { timeout: 30000 });
    const server = await page.$(".server-body");
    if (!server) throw new Error("No servers found");
    await server.click();
    console.log("clicked on the server");
    return { success: true, status: "successfully navigated to server" };
    {
    }
  } catch (err) {
    console.error(`Server navigation error: ${err.message}`);
    serverInfo.status = "navigation error";
    return { success: false, error: err.message };
  }
}

// Add these constants at the top
const MAX_SERVER_ATTEMPTS = 5;
const MAX_QUEUE_CHECKS = 20;

async function handleServerStatus() {
  let attempts = 0;
  while (attempts < MAX_SERVER_ATTEMPTS) {
    attempts++;
    try {
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
        await page.click("#start");
        await delay(3000);

        const newStatus = await getCurrentStatus();
        console.log("Post-start status:", newStatus);
      }
      const isStartingPhase = [
        "loading",
        "starting",
        "saving",
        "preparing",
      ].some((phase) => status.includes(phase));
      if (isStartingPhase) {
        console.log("Monitoring starting phase...");
        const phaseResult = await monitorStartingPhase();
        if (phaseResult === "online") continue;
      }

      const isWaitingPhase = ["queue", "waiting"].some((phase) =>
        status.includes(phase)
      );
      if (isWaitingPhase) {
        const queueResult = await handleQueueProcess();
        console.log({ queueResult });
        if (queueResult === "online") continue;
      }

      await delay(10000);
    } catch (err) {
      console.log("Server status error:", err.message);
      await delay(10000);
    }
  }

  throw new Error(`Failed after ${MAX_SERVER_ATTEMPTS} attempts`);
}

async function handleQueueProcess() {
  let checks = 0;
  let position = null;
  while (checks < MAX_QUEUE_CHECKS || position < Infinity) {
    checks++;
    try {
      console.log(`Queue check ${checks}/${MAX_QUEUE_CHECKS}`);
      const status = await getCurrentStatus();
      console.log({ status });
      if (status === "online") return "online";
      if (status === "offline") return "offline";

      // Confirm button handling
      const confirmButtonExists = await page.evaluate(() => {
        const button = document.querySelector("#confirm");

        if (!button) return null;

        const style = window.getComputedStyle(button);
        return style.display === "flex";
      });
      console.log("confirm button status:", confirmButtonExists);

      if (confirmButtonExists) {
        const serverConfirmation = await confirmServerActiviation();
        console.log({ serverConfirmation });
        const result = await monitorStartingPhase();
        if (result === "online") return "online";
      }

      // Queue position handling
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

      // Dynamic waiting
      const waitTime = position <= 3000 ? 5000 : 15000;
      console.log(`Waiting ${waitTime / 1000}s...`);
      await delay(waitTime);
    } catch (err) {
      console.log("Queue error:", err.message);
      await delay(10000);
    }
  }

  throw new Error(
    `Queue processing failed after ${MAX_QUEUE_CHECKS} checks at poistion ${position}`
  );
}

async function confirmServerActiviation() {
  try {
    // Confirm button
    await page.waitForSelector("#confirm", { timeout: 30000 });
    await page.click("#confirm");
    console.log("✅ Confirmation clicked");
    await delay(2000);

    // // Start button
    // await page.waitForSelector("#start", { timeout: 30000 });
    // await page.click("#start");
    // console.log("▶️ Start clicked");

    return "success";
  } catch (err) {
    console.log("Activation failed:", err.message);
    throw err; // Propagate error
  }
}

async function monitorStartingPhase() {
  const MAX_CHECKS = 10;
  for (let i = 0; i < MAX_CHECKS; i++) {
    const s = await getCurrentStatus();
    console.log(`Monitor ${i + 1}/${MAX_CHECKS}: ${s}`);
    serverInfo.status = s;

    if (s === "online") {
      console.log("🎉 Server is now ONLINE!");
      serverInfo.success = true;
      return "online";
    }
    if (s === "offline") {
      console.log("⚠️ Server went offline during preparing");
      return "offline";
    }

    await delay(30000);
  }
  console.log("⏲️ Monitor timed out (5min)");
  return serverInfo.status;
}

module.exports = {
  initiateServer,
  logInToAternos,
  handleServerStatus,
  handleQueueProcess,
};
