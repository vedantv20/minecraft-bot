require("dotenv/config");
const http = require("node:http");
const mineflayer = require("mineflayer");
const { initiateServer } = require("./server.js");
const Vec3 = require("vec3");
const {
  pathfinder,
  Movements,
  goals: { GoalNear },
} = require("mineflayer-pathfinder");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log(
  "PUPPETEER_EXECUTABLE_PATH:",
  process.env.PUPPETEER_EXECUTABLE_PATH
);
console.log("Chromium Path:", require("puppeteer").executablePath());

const MIN_CORNER = new Vec3(-306, 183, -14);
const MAX_CORNER = new Vec3(-297, 185, -4);
let bot = null;
let goingToSleep = false;
let lastActivity = Date.now();
let serverCheckAttempts = 0;
let isShuttingDown = false;
let isConnecting = false; // Track connection state
let connectionTimeout = null; // Track connection timeout
let sleepInterval = null;
let activityInterval = null;

// Handle graceful shutdown
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

function gracefulShutdown() {
  console.log("Received shutdown signal");
  isShuttingDown = true;
  if (sleepInterval) clearInterval(sleepInterval);
  if (activityInterval) clearInterval(activityInterval);
  if (connectionTimeout) {
    // Clear any pending timers
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }

  if (bot) {
    console.log("Disconnecting bot...");
    try {
      bot.quit();
    } catch (err) {
      console.error("Error disconnecting bot:", err);
    }
  }

  // Force exit after 5 seconds if still running
  setTimeout(() => {
    console.log("Forcing exit after timeout");
    process.exit(0);
  }, 5000);
}

async function checkServer() {
  if (isShuttingDown || isConnecting) return;

  isConnecting = true;
  try {
    const server = await initiateServer();
    serverCheckAttempts++;
    if (!server || !server.success) {
      console.log("server error:", server?.error);
      if (serverCheckAttempts < 5) {
        console.log("retrying to initiate the server");
        connectionTimeout = setTimeout(() => {
          isConnecting = false;
          checkServer();
        }, 30000); // Add delay between retries
      } else {
        console.log("stopping server initiation.");

        // Reset attempt counter and retry after longer delay
        serverCheckAttempts = 0;
        connectionTimeout = setTimeout(() => {
          isConnecting = false;
          checkServer();
        }, 5 * 60 * 1000); // 5 minutes
      }
    } else {
      serverCheckAttempts = 0;
      console.log("Bot will join the server in few seconds");
      connectionTimeout = setTimeout(() => {
        isConnecting = false;
        createBot();
      }, 25000);
    }
  } catch (error) {
    console.error("Unexpected error in checkServer:", error);
    isConnecting = false;
    connectionTimeout = setTimeout(checkServer, 60000);
  }
}

function createBot() {
  if (isShuttingDown) return;
  if (bot) {
    // Ensure previous bot instance is properly terminated
    try {
      console.log("Bot already exists, disconnecting the previous instance.");
      bot.quit();
    } catch (err) {
      console.log("Error disconnecting previous bot instance:", err);
    }
    bot = null;
  }

  try {
    bot = mineflayer.createBot({
      host: process.env.host,
      port: parseInt(process.env.port),
      username: process.env.name,
      version: "1.21.4",
      auth: "offline",
      checkTimeoutInterval: 30000,
      connectTimeout: 45000,
      keepAlive: true,
      closeTimeout: 45000,
      physicEnabled: true,
      reconnect: false,
      minTimeout: 5000,
      maxTimeout: 30000,
    });

    bot.loadPlugin(pathfinder);
    let hasSpawned = false;

    // After bot spawns
    bot.once("spawn", () => {
      hasSpawned = true;
      console.log("Bot spawned!");
      setupPathfinder();
      handleSleep();
      performRandomActivity();
      scheduleRandomActivity();
    });
    // Add timeout for initial connection
    const spawnTimeout = setTimeout(() => {
      if (!hasSpawned && bot) {
        console.log("Bot spawn timeout - force disconnecting");
        try {
          bot.quit();
        } catch (err) {
          console.log("Error in spawn timeout disconnect:", err);
        }
        bot = null;
        setTimeout(checkServer, 30000);
      }
    }, 60000);

    bot.on("error", (err) => {
      console.log("Bot error:", err);
      clearTimeout(spawnTimeout);
      if (!isShuttingDown) {
        // Don't attempt reconnection during shutdown
        setTimeout(checkServer, 30000);
      }
    });

    bot.on("kicked", (reason) => {
      console.log(
        `Kicked: ${
          typeof reason === "object" ? JSON.stringify(reason) : reason
        }`
      );
      clearTimeout(spawnTimeout);

      try {
        // Handle different types of kick reasons
        if (typeof reason === "string") {
          let parsedReason;
          try {
            parsedReason = JSON.parse(reason);
          } catch {
            // If not JSON, use the string directly
            parsedReason = reason;
          }

          // Check for duplicate login specifically
          if (
            reason.includes("duplicate_login") ||
            parsedReason?.value?.translate?.value ===
              "multiplayer.disconnect.duplicate_login"
          ) {
            console.log(
              "Detected duplicate login, waiting longer before reconnecting..."
            );
            setTimeout(checkServer, 2 * 60 * 1000); // Wait 2 minutes
            return;
          }

          // Handle ban case
          if (
            parsedReason?.value?.translate?.value ===
            "multiplayer.disconnect.banned"
          ) {
            console.log("trying to unban the bot...");
            // setTimeout(checkServer, 45000);
            return;
          }
        }

        // Default handling for other kick reasons
        setTimeout(checkServer, 45000);
      } catch (err) {
        console.log("Error parsing kick reason:", err.message);
        setTimeout(checkServer, 45000);
      }
    });

    // Enhance error handling in the bot.on("end") handler
    bot.on("end", (reason) => {
      console.log("Bot has disconnected from the server:", reason);
      clearTimeout(spawnTimeout);
      if (!isShuttingDown) {
        // Add progressive delay based on reason
        let delay = 45000;
        if (reason === "socketClosed") {
          delay = 60000; // Longer delay for connection issues
          console.log("Socket closed, will reconnect with longer delay");
        }
        console.log(`Will attempt reconnection in ${delay / 1000} seconds`);
        setTimeout(checkServer, delay);
      }
    });
  } catch (err) {
    console.error("Error creating bot:", err);
    setTimeout(checkServer, 60000); // Retry after 1 minute
  }
}

function setupPathfinder() {
  const movements = new Movements(bot, bot.registry);
  movements.allowFreeMotion = false;
  movements.allowParkour = true;
  movements.allow1by1towers = true;

  movements.isPositionAllowed = (pos) =>
    pos.x >= MIN_CORNER.x - 1 &&
    pos.x <= MAX_CORNER.x + 1 &&
    pos.y >= MIN_CORNER.y - 1 &&
    pos.y <= MAX_CORNER.y + 1 &&
    pos.z >= MIN_CORNER.z - 1 &&
    pos.z <= MAX_CORNER.z + 1;

  bot.pathfinder.setMovements(movements);
}

function handleSleep() {
  sleepInterval = setInterval(async () => {
    if (
      !bot ||
      goingToSleep ||
      isShuttingDown ||
      !bot.entity ||
      bot.isSleeping
    ) {
      if (isShuttingDown) {
        clearInterval(sleepInterval);
      }
      return;
    }

    const dayTime = bot.time.timeOfDay;
    if (dayTime >= 13000 && dayTime <= 23000) {
      goingToSleep = true;
      try {
        let bed = bot.findBlock({
          matching: (block) => bot.isABed(block),
          maxDistance: 9,
        });

        if (bed) {
          const moveTo = bed.position.offset(0, 0, 1);
          await bot.pathfinder.goto(
            new GoalNear(moveTo.x, moveTo.y, moveTo.z, 1)
          );
          await bot.lookAt(bed.position.offset(0.5, 0.5, 0.5));
          await bot.sleep(bed);
          console.log("Bot is sleeping on existing bed.");
        } else {
          console.log("No bed nearby. Checking inventory to place bed...");

          const bedItem = bot.inventory
            .items()
            .find((item) => item.name.includes("bed"));

          if (bedItem) {
            const placementPos = findSafePlacementPosition();

            if (!placementPos) {
              console.log("No safe position to place the bed.");
            } else {
              await bot.equip(bedItem, "hand");
              await bot.placeBlock(
                bot.blockAt(placementPos.offset(0, -1, 0)),
                new Vec3(0, 1, 0)
              ); // place on top of block under target
              console.log("Placed bed at", placementPos);

              // Wait a tick or two for world to update
              await new Promise((res) => setTimeout(res, 1000));

              const placedBed = bot.findBlock({
                matching: (block) => bot.isABed(block),
                maxDistance: 4,
              });

              if (placedBed) {
                const moveTo = placedBed.position.offset(0, 0, 1);
                await bot.pathfinder.goto(
                  new GoalNear(moveTo.x, moveTo.y, moveTo.z, 1)
                );
                await bot.lookAt(placedBed.position.offset(0.5, 0.5, 0.5));
                await bot.sleep(placedBed);
                console.log("Bot is sleeping on newly placed bed.");
              } else {
                console.log("Failed to detect newly placed bed.");
              }
            }
          } else {
            console.log("No bed item in inventory.");
          }
        }
      } catch (err) {
        console.log("Sleep error:", err.message);
      } finally {
        goingToSleep = false;
      }
    }
  }, 15000);
}

function findSafePlacementPosition() {
  if (!bot || !bot.entity) return null;

  const botPos = bot.entity.position.floored();

  const offsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
  ];

  for (const offset of offsets) {
    const pos = botPos.plus(offset);
    const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
    const blockAtPos = bot.blockAt(pos);
    const blockAbove = bot.blockAt(pos.offset(0, 1, 0));

    if (
      blockBelow &&
      blockBelow.boundingBox === "block" && // solid ground
      blockAtPos &&
      blockAtPos.name === "air" && // empty space
      blockAbove &&
      blockAbove.name === "air"
    ) {
      return pos;
    }
  }

  return null;
}

function scheduleRandomActivity() {
  if (isShuttingDown) return;

  // Clear any existing interval
  if (activityInterval) {
    clearInterval(activityInterval);
    activityInterval = null;
  }

  const maxDelay = 100 * 1000;
  const minDelay = 50 * 1000;

  let delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

  // If bot has been inactive for too long, act quickly
  if (Date.now() - lastActivity > 120000) {
    delay = 3000;
    console.log("Idle too long, triggering activity.");
  }

  console.log(`Scheduling random activity in ${delay / 1000} seconds`);

  // Setting timeout (not interval) to perform activity once
  setTimeout(() => {
    performRandomActivity();
    // Re-schedule another activity
    if (!isShuttingDown && bot && bot.entity) {
      scheduleRandomActivity();
    }
  }, delay);
}

function performRandomActivity() {
  if (!bot || !bot.entity || bot.isSleeping || goingToSleep || isShuttingDown) {
    console.log("Cannot perform activity - bot unavailable or sleeping");
    return;
  }

  console.log("Performing a random activity now");
  const activities = [doRandomChat, doRandomJump, doRandomMove];
  try {
    const activity = activities[Math.floor(Math.random() * activities.length)];
    activity();
    lastActivity = Date.now();
  } catch (err) {
    console.log("Activity error:", err.message);
  }
}

function doRandomChat() {
  console.log("Chatting...");
  if (!bot) return;
  const messages = [
    "Hello world!",
    "What's up?",
    "Living the cube life.",
    "Just chilling here.",
    "Where are my diamonds?",
    "noob!",
  ];
  bot.chat(messages[Math.floor(Math.random() * messages.length)]);
  console.log("Bot chatted.");
}

function doRandomJump() {
  console.log("Jumping...");
  if (!bot || !bot.entity) return;

  const jumps = Math.floor(Math.random() * 3) + 1;
  let count = 0;
  const jumpInterval = setInterval(() => {
    if (!bot || isShuttingDown || !bot.entity) {
      clearInterval(jumpInterval);
      return;
    }

    bot.setControlState("jump", true);
    setTimeout(() => {
      if (bot && bot.entity) bot.setControlState("jump", false);
    }, 300);
    count++;
    if (count >= jumps) clearInterval(jumpInterval);
  }, 600);
}

function doRandomMove() {
  console.log("Moving...");
  if (!bot || !bot.entity) return;

  const directions = ["forward", "back", "left", "right"];
  const dir = directions[Math.floor(Math.random() * directions.length)];
  const duration = Math.floor(Math.random() * 3000) + 1000;

  bot.setControlState(dir, true);
  setTimeout(() => {
    if (!bot || isShuttingDown || !bot.entity) return;
    bot.setControlState(dir, false);
    console.log(`Moved ${dir} for ${duration}ms`);
  }, duration);
}

function createHttpServer() {
  const PORT = process.env.server_port || 3000;
  const server = http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const status = bot ? "connected" : "disconnected";
      res.end(`Bot is alive! Status: ${status}\n`);
    })
    .listen(PORT, () => {
      console.log(`HTTP Server running on port ${PORT}`);
    });

  // Handle server shutdown
  process.on("SIGINT", () => {
    server.close();
  });
  process.on("SIGTERM", () => {
    server.close();
  });
}

function startSelfPing() {
  const url = process.env.SELF_URL;
  const pingInterval = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(pingInterval);
      return;
    }

    if (url) {
      fetch(url)
        .then((res) => console.log(`Self-ping success: ${res.status}`))
        .catch((err) => console.log(`Self-ping error: ${err.message}`));
    } else {
      console.log("SELF_URL not set in environment.");
    }
  }, 12 * 60 * 1000);
}

createHttpServer();
startSelfPing();
checkServer();
