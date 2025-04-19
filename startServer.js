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
    if (!serverResponse || !serverResponse.success)
      throw new Error("Failed to navigate to server");

    console.log("Server Info:", serverInfo);
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
  let status = await page.$eval(".statuslabel-label", (el) =>
    el.textContent.trim().toLowerCase()
  );
  while (["stopping", "saving"].includes(status)) {
    console.log(`Server is ${status}, waiting 10 seconds...`);
    await delay(10000);
    status = await page.$eval(".statuslabel-label", (el) =>
      el.textContent.trim().toLowerCase()
    );
  }
  return status;
}

async function logInToAternos() {
  const { ATERNOS_USERNAME, ATERNOS_PASSWORD } = process.env;
  if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD) {
    throw new Error("Missing Aternos credentials in environment variables");
  }

  browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();

  if (fs.existsSync(COOKIE_PATH)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
      await page.setCookie(...cookies);
      await page.goto("https://aternos.org/servers/", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      if (await page.$(".server-name")) {
        console.log("✅ Loaded via cookies, no login needed");
        return true;
      }
      console.log("⚠️ Saved cookies invalid, falling back to login");
      fs.unlinkSync(COOKIE_PATH);
    } catch (err) {
      console.warn("Error using saved cookies:", err.message);
      fs.unlinkSync(COOKIE_PATH);
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
    console.error("❌ Login failed – bad credentials or captcha");
    return false;
  }

  const freshCookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(freshCookies, null, 2));
  console.log("💾 Cookies saved for future sessions");
  return true;
}

async function navigateToServer() {
  try {
    const { ATERNOS_SERVER_NAME } = process.env;
    await page.goto("https://aternos.org/servers/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await page.waitForSelector(".server-name", { timeout: 30000 });

    if (ATERNOS_SERVER_NAME) {
      const servers = await page.$$(".server-name");
      let clicked = false;
      for (const server of servers) {
        const name = await server.evaluate((el) => el.textContent.trim());
        if (name === ATERNOS_SERVER_NAME) {
          await server.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        console.warn("Server name not found, clicking first available");
        await servers[0].click();
      }
    } else {
      const first = await page.$(".server-name");
      if (!first) throw new Error("No servers found");
      await first.click();
    }

    const status = await getCurrentStatus();
    console.log("Current server status is:", status);
    serverInfo.status = status;
    serverInfo.success = status === "online";
    return { success: true };
  } catch (err) {
    console.error(`Server navigation error: ${err.message}`);
    serverInfo.status = "navigation error";
    return { success: false, error: err.message };
  }
}

async function handleServerStatus() {
  while (true) {
    const status = await getCurrentStatus();
    console.log("Checking server status:", status);
    serverInfo.status = status;

    if (status === "online") {
      console.log("🎉 Server is ONLINE!");
      serverInfo.success = true;
      return "online";
    }

    if (["preparing", "starting"].includes(status)) {
      console.log("🚧 Server is in starting phase, monitoring...");
      const newStatus = await monitorStartingPhase();
      if (newStatus === "online") continue;
      if (newStatus === "offline") {
        console.log("🔄 Server went offline during start, retrying...");
        await page.click("#start");
        continue;
      }
    }

    if (status === "offline") {
      console.log("Server is offline. Attempting initial start...");
      await page.click("#start");
      const queueResult = await handleQueueProcess();
      if (queueResult === "online") continue;
      continue;
    }

    console.log("Server queued, handling queue...");
    const queueResult = await handleQueueProcess();
    if (queueResult === "online") continue;
  }
}

async function handleQueueProcess() {
  console.log("In queue state; monitoring position...");
  while (true) {
    try {
      const currentStatus = await getCurrentStatus();

      if (["online", "starting", "preparing"].includes(currentStatus)) {
        console.log(
          `⚡ Status changed to '${currentStatus}', switching to monitor`
        );
        return await monitorStartingPhase();
      }

      const posText = await page
        .$eval(".queue-position", (el) => el.textContent.trim())
        .catch(() => null);
      let pos = parseInt(posText?.match(/(\d+)/)?.[1] || NaN, 10);
      console.log(`⏳ Queue position: ${posText}`);

      if (!isNaN(pos) && pos <= 1) {
        console.log("🔔 Position 1 reached; clicking 'Confirm now'...");
        await page.waitForFunction(
          () => {
            const btn = document.querySelector("#success");
            return btn?.textContent
              .trim()
              .toLowerCase()
              .includes("confirm now");
          },
          { timeout: 30000 }
        );
        await page.click("#success");
        console.log("✅ 'Confirm now' clicked");

        await page.waitForSelector("#start", { timeout: 30000 });
        await page.click("#start");
        console.log("▶️ 'Start' clicked");

        return await monitorStartingPhase();
      }

      const delayTime = !isNaN(pos) && pos <= 3000 ? 5000 : 30000;
      console.log(`Waiting ${delayTime / 1000}s before rechecking queue...`);
      await delay(delayTime);
    } catch (err) {
      console.log(`Queue error: ${err.message}`);
      console.log("Retrying in 30s...");
      await delay(30000);
    }
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

process.on("SIGINT", async () => {
  console.log("Received SIGINT. Cleaning up...");
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM. Cleaning up...");
  await cleanup();
  process.exit(0);
});

if (require.main === module) {
  initiateServer()
    .then((result) => {
      console.log("Script completed with result:", result);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Script failed with error:", error);
      process.exit(1);
    });
}

module.exports = {
  initiateServer,
  logInToAternos,
  handleServerStatus,
  handleQueueProcess,
};
