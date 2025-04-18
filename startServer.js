require("dotenv/config");
const puppeteer = require("puppeteer");

// Global state
let browser = null;
let page = null;
const serverInfo = { status: "unknown", success: false };

// Main entry point - this will be called once
async function initiateServer() {
  try {
    // Login to Aternos
    const loginStatus = await logInToAternos();
    if (!loginStatus) {
      throw new Error("Login failed");
    }

    // Navigate to the game server
    const serverResponse = await navigateToServer();
    if (!serverResponse || !serverResponse.success) {
      throw new Error("Failed to navigate to server");
    }

    console.log("Server Info:", serverInfo);

    // Handle server status and startup
    const serverStatus = await handleServerStatus();
    console.log("Final server status:", serverStatus);

    // Successful completion
    return { success: true, status: serverStatus };
  } catch (error) {
    console.error(`Server initiation failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Always clean up resources
    await cleanup();
  }
}

// Helper function to clean up resources
async function cleanup() {
  if (browser) {
    try {
      await browser.close();
      console.log("Browser closed");
    } catch (error) {
      console.error("Error closing browser:", error);
    }
    browser = null;
    page = null;
  }
}

// Delay helper function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function logInToAternos() {
  console.log("Attempting to start Aternos server...");
  const ATERNOS_USERNAME = process.env.ATERNOS_USERNAME;
  const ATERNOS_PASSWORD = process.env.ATERNOS_PASSWORD;
  const ATERNOS_SERVER_NAME = process.env.ATERNOS_SERVER_NAME;

  if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD || !ATERNOS_SERVER_NAME) {
    throw new Error("Missing Aternos credentials in environment variables");
  }

  try {
    // Launch browser with proper options
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    page = await browser.newPage();
    console.log("Browser launched, navigating to Aternos...");

    // Navigate to login page
    await page.goto("https://aternos.org/go/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Enter credentials
    await page.type(".username", ATERNOS_USERNAME);
    await page.type(".password", ATERNOS_PASSWORD);

    // Submit login form and wait for navigation
    await Promise.all([
      page.click(".login-button"),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    // Check if login successful
    if (page.url().includes("go/?login")) {
      console.error("Login failed. Please check your credentials.");
      return false;
    }

    console.log("Login successful, navigating to server page...");
    return true;
  } catch (error) {
    console.error(`Login error: ${error.message}`);
    throw error; // Propagate the error to be handled by the caller
  }
}

async function navigateToServer() {
  try {
    const ATERNOS_SERVER_NAME = process.env.ATERNOS_SERVER_NAME;

    // Go to server page
    await page.goto("https://aternos.org/servers/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Wait for server list to load
    await page.waitForSelector(".server-name", { timeout: 30000 });

    // Check if we need to find a specific server by name
    if (ATERNOS_SERVER_NAME) {
      // Find server by name (more precise than just clicking the first one)
      const serverSelector = await page.evaluate((serverName) => {
        const serverElements = Array.from(document.querySelectorAll(".server"));
        for (const element of serverElements) {
          const nameElement = element.querySelector(".server-name");
          if (
            nameElement &&
            nameElement.textContent.trim().includes(serverName)
          ) {
            return `.server[data-id="${element.getAttribute("data-id")}"]`;
          }
        }
        return null;
      }, ATERNOS_SERVER_NAME);

      if (serverSelector) {
        await page.click(serverSelector);
      } else {
        console.error(`Server "${ATERNOS_SERVER_NAME}" not found!`);
        serverInfo.status = "not found";
        return { success: false, serverInfo };
      }
    } else {
      // Just click the first server if no specific name provided
      const serverFound = await page.$(".server-name");
      if (serverFound) {
        await serverFound.click();
      } else {
        console.error("No servers found!");
        serverInfo.status = "no servers";
        return { success: false, serverInfo };
      }
    }

    // Wait for server page to load
    await page.waitForSelector(".statuslabel-label", { timeout: 30000 });

    // Get initial server status
    const serverStatus = await page.$eval(".statuslabel-label", (el) =>
      el.textContent.trim().toLowerCase()
    );

    console.log("Current server status is:", serverStatus);
    serverInfo.status = serverStatus;

    // If server is already online, we're done
    if (serverStatus === "online") {
      console.log("Server is already running!");
      serverInfo.success = true;
      return { success: true, serverInfo };
    }

    // Otherwise, continue to server management
    return { success: true, serverInfo };
  } catch (error) {
    console.error(`Server navigation error: ${error.message}`);
    serverInfo.status = "navigation error";
    return { success: false, serverInfo, error: error.message };
  }
}

async function handleServerStatus() {
  try {
    await page.waitForSelector(".statuslabel-label", { timeout: 30000 });

    const serverStatus = await page.$eval(".statuslabel-label", (el) =>
      el.textContent.trim().toLowerCase()
    );

    console.log("Current server status is:", serverStatus);

    // Handle different status cases
    if (["online", "preparing", "starting"].includes(serverStatus)) {
      console.log(`✅ Server is now ${serverStatus}`);
      serverInfo.status = serverStatus;
      return await monitorStartingPhase();
    } else if (
      serverStatus.includes("waiting") ||
      serverStatus.includes("queue")
    ) {
      const result = await handleQueueProcess();
      return result;
    } else if (serverStatus === "offline") {
      console.log("Server is offline. Attempting to start it...");
      await page.click("#start");
      const result = await handleQueueProcess();
      return result;
    } else {
      console.log(`Unexpected server status: ${serverStatus}`);
      serverInfo.status = serverStatus;
      return serverStatus;
    }
  } catch (error) {
    console.error(`Error handling server status: ${error.message}`);
    serverInfo.status = "error";
    return "error";
  }
}

async function handleQueueProcess() {
  // Wait for status to change to "waiting in queue"
  try {
    await page.waitForFunction(
      () => {
        const status = document.querySelector(".statuslabel-label");
        if (!status) return false;
        const text = status.textContent.toLowerCase();
        return text.includes("queue") || text.includes("waiting");
      },
      { timeout: 30000 }
    );
    console.log("Now in queue state. Looking for queue position...");
  } catch (error) {
    console.log("⚠️ Queue status change not detected. Continuing anyway...");
  }

  // Queue monitoring loop
  let queueComplete = false;
  while (!queueComplete) {
    try {
      // Check current server status
      const currentStatus = await page.$eval(".statuslabel-label", (el) =>
        el.textContent.trim().toLowerCase()
      );

      console.log(`Current status: ${currentStatus}`);
      serverInfo.status = currentStatus;

      // If we're already preparing/starting/online, we can skip the queue
      if (
        currentStatus.includes("preparing") ||
        currentStatus.includes("starting") ||
        currentStatus === "online"
      ) {
        console.log(`Status changed to: ${currentStatus}.`);
        queueComplete = true;
        continue;
      }

      // Check if queue elements exist
      const positionExists = await page.evaluate(
        () => !!document.querySelector(".queue-position")
      );

      const timeExists = await page.evaluate(
        () => !!document.querySelector(".queue-time")
      );

      if (positionExists && timeExists) {
        // Get queue position and estimated time
        const posText = await page.$eval(".queue-position", (el) =>
          el.textContent.trim()
        );
        const eta = await page.$eval(".queue-time", (el) =>
          el.textContent.trim()
        );

        // Parse the position number, handling the format like "2000/6100"
        let currentPos = NaN;
        try {
          const posMatch = posText.match(/(\d+)/);
          if (posMatch && posMatch[1]) {
            currentPos = parseInt(posMatch[1], 10);
          }
        } catch (err) {
          console.log("Could not parse position number");
        }

        if (!isNaN(currentPos)) {
          console.log(
            `⏳ Current queue position: ${currentPos} (${posText}) - ETA: ${eta}`
          );

          // Check if we're at position 1
          if (currentPos <= 1) {
            console.log(
              "🔔 Queue position reached 1! Watching for confirm button..."
            );

            // Look for confirm button
            const confirmButtonExists = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll("button"));
              return buttons.some((button) =>
                button.textContent.toLowerCase().includes("confirm")
              );
            });

            if (confirmButtonExists) {
              console.log("Found confirm button, attempting to click...");

              try {
                // Using evaluate to find and click the button directly in the page context
                await page.evaluate(() => {
                  const buttons = Array.from(
                    document.querySelectorAll("button")
                  );
                  const confirmButton = buttons.find((button) =>
                    button.textContent.toLowerCase().includes("confirm")
                  );
                  if (confirmButton) confirmButton.click();
                });

                console.log("✅ Confirm button clicked!");
                // Wait a bit after clicking confirm
                await delay(5000);
              } catch (err) {
                console.log(`Error clicking confirm button: ${err.message}`);
              }
            }
          }
        } else {
          console.log("⚠️ Could not parse queue position number");
        }
      } else {
        console.log("Queue position elements not found");
      }
    } catch (err) {
      console.log(`Error in queue monitoring: ${err.message}`);
    }

    // Wait before next check (30 seconds)
    console.log("Waiting 30 seconds before checking again...");
    await delay(30000);

    // Check if status has changed to indicate queue completion
    try {
      const newStatus = await page.$eval(".statuslabel-label", (el) =>
        el.textContent.trim().toLowerCase()
      );

      serverInfo.status = newStatus;

      if (
        newStatus.includes("preparing") ||
        newStatus.includes("starting") ||
        newStatus === "online"
      ) {
        console.log(`Status changed to: ${newStatus}. Queue completed!`);
        queueComplete = true;
      }
    } catch (err) {
      console.log(`Error checking status: ${err.message}`);
    }
  }

  try {
    // Wait for preparing/starting status
    await page.waitForFunction(
      () => {
        const label = document.querySelector(".statuslabel-label");
        if (!label) return false;
        const text = label.textContent.toLowerCase();
        return text.includes("preparing") || text.includes("starting");
      },
      { timeout: 300000 } // 5 minutes timeout
    );

    console.log("🚧 Server is preparing/starting...");

    // Finally wait for "Online" status
    await page.waitForFunction(
      () => {
        const label = document.querySelector(".statuslabel-label");
        if (!label) return false;
        return label.textContent.trim().toLowerCase() === "online";
      },
      { timeout: 600000 } // 10 minutes timeout
    );

    console.log("🎉 Server is ONLINE!");
    serverInfo.status = "online";
    serverInfo.success = true;
    return "online";
  } catch (error) {
    console.error(`Error waiting for server to come online: ${error.message}`);
    // Get the latest status
    try {
      const latestStatus = await page.$eval(".statuslabel-label", (el) =>
        el.textContent.trim().toLowerCase()
      );
      serverInfo.status = latestStatus;
      return latestStatus;
    } catch (e) {
      // If even this fails, just note the error
      console.error(`Could not get final status: ${e.message}`);
      serverInfo.status = "unknown (error occurred)";
      return "unknown";
    }
  }
}

async function monitorStartingPhase() {
  const MAX_CHECKS = 20; // 10 minutes (20 checks * 30 seconds)
  let checkCount = 0;

  console.log("Monitoring server starting phase...");

  while (checkCount < MAX_CHECKS) {
    try {
      const currentStatus = await page.$eval(".statuslabel-label", (el) =>
        el.textContent.trim().toLowerCase()
      );

      console.log(
        `Check ${
          checkCount + 1
        }/${MAX_CHECKS}: Server status is ${currentStatus}`
      );
      serverInfo.status = currentStatus;

      if (currentStatus === "online") {
        console.log("🎉 Server is now ONLINE!");
        serverInfo.status = "online";
        serverInfo.success = true;
        return "online";
      }

      if (currentStatus !== "preparing" && currentStatus !== "starting") {
        console.log(
          `Server is no longer in starting phase. Current status: ${currentStatus}`
        );
        serverInfo.status = currentStatus;
        return currentStatus;
      }

      await delay(30000); // Wait 30 seconds before checking again
      checkCount++;
    } catch (error) {
      console.error(`Error while monitoring: ${error.message}`);
      break;
    }
  }

  // If we reach here, we've timed out
  console.log("Monitoring timed out. Getting final status...");
  try {
    const finalStatus = await page.$eval(".statuslabel-label", (el) =>
      el.textContent.trim().toLowerCase()
    );
    serverInfo.status = finalStatus;
    return finalStatus;
  } catch (error) {
    console.error(`Error getting final status: ${error.message}`);
    serverInfo.status = "timeout";
    return "timeout";
  }
}

// Add graceful termination handlers
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

// Main execution
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

// Export for tests or external usage
module.exports = {
  initiateServer,
  logInToAternos,
  handleServerStatus,
  handleQueueProcess,
};
