require("dotenv/config");
const http = require("node:http");
const mineflayer = require("mineflayer");
const Vec3 = require("vec3");
const {
  pathfinder,
  Movements,
  goals: { GoalNear },
} = require("mineflayer-pathfinder");

const MIN_CORNER = new Vec3(-306, 183, -14);
const MAX_CORNER = new Vec3(-297, 185, -4);
let bot = null;
let connectingAttempts = 0;
const MAX_CONNECT_ATTEMPTS = 3;
let goingToSleep = false;
let lastActivity = Date.now();
let isConnecting = false;
let connectionTimeout = null;
let activityInterval = null;
let sleepInterval = null;

async function connectToServer() {
  if (isConnecting) {
    console.log(
      "Already attempting to connect, skipping new connection request"
    );
    return;
  }

  isConnecting = true;
  console.log(
    `Connecting attempt ${connectingAttempts + 1}/${MAX_CONNECT_ATTEMPTS}`
  );

  try {
    ++connectingAttempts;
    if (connectingAttempts > MAX_CONNECT_ATTEMPTS) {
      connectingAttempts = 0;
      console.log(
        "Max connecting attempts reached, waiting before trying again."
      );
      setTimeout(() => {
        isConnecting = false;
        connectToServer();
      }, 120000);
      return;
    }

    // Clear any existing timeout
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
    }

    // Set timeout to actually create the bot
    console.log("Scheduling bot creation in 10 seconds...");
    connectionTimeout = setTimeout(() => {
      createBot();
    }, 10000);
  } catch (err) {
    console.log("Unable to connect to server", err.message);
    isConnecting = false;

    // Retry after a delay
    setTimeout(() => {
      connectToServer();
    }, 30000);
  }
}

function createBot() {
  if (bot) {
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
      checkTimeoutInterval: 60000,
      connectTimeout: 60000,
      keepAlive: true,
      closeTimeout: 60000,
      physicEnabled: true,
      reconnect: false,
      minTimeout: 5000,
      maxTimeout: 30000,
      skipValidation: true,
      hideErrors: false,
    });

    bot.loadPlugin(pathfinder);
    let hasSpawned = false;

    // After bot spawns
    bot.once("spawn", () => {
      hasSpawned = true;
      isConnecting = false;
      connectingAttempts = 0;
      console.log("Bot spawned successfully!");
      console.log(`Bot position: ${bot.entity.position}`);
      setupPathfinder();
      handleSleep();
      performRandomActivity();
      scheduleRandomActivity();
    });

    const spawnTimeout = setTimeout(() => {
      if (!hasSpawned && bot) {
        console.log("Bot spawn timeout - force disconnecting");
        try {
          bot.quit();
        } catch (err) {
          console.log("Error in spawn timeout disconnect:", err);
        }
        bot = null;
        isConnecting = false;
        setTimeout(connectToServer, 30000);
      }
    }, 60000);

    bot.on("error", (err) => {
      if (err.name === "PartialReadError" && err.message.includes("VarInt")) {
        console.log("Handled packet reading error!");
        return;
      }

      console.log("Bot error:", err);
      clearTimeout(spawnTimeout);
      isConnecting = false;
      if (bot) {
        setTimeout(connectToServer, 30000);
      }
    });

    bot.on("kicked", (reason) => {
      console.log(
        `Kicked: ${
          typeof reason === "object" ? JSON.stringify(reason) : reason
        }`
      );
      clearTimeout(spawnTimeout);
      isConnecting = false;

      try {
        if (typeof reason === "string") {
          let parsedReason;
          try {
            parsedReason = JSON.parse(reason);
          } catch {
            parsedReason = reason;
          }

          // Check for duplicate login specifically
          if (
            reason.includes("duplicate_login") ||
            parsedReason?.value?.translate?.value ===
              "multiplayer.disconnect.duplicate_login"
          ) {
            console.log("Detected duplicate login!");
            return;
          }

          // Handle ban case
          if (
            parsedReason?.value?.translate?.value ===
            "multiplayer.disconnect.banned"
          ) {
            console.log("trying to unban the bot...");
            return;
          }
        }

        setTimeout(connectToServer, 45000);
      } catch (err) {
        console.log("Error parsing kick reason:", err.message);
        setTimeout(connectToServer, 45000);
      }
    });

    bot.on("end", (reason) => {
      console.log("Bot has disconnected from the server:", reason);
      clearTimeout(spawnTimeout);
      isConnecting = false;

      let delay = 45000;
      if (reason === "socketClosed") {
        delay = 30000;
        console.log("Socket closed, will reconnect with longer delay");
      }
      console.log(`Will attempt reconnection in ${delay / 1000} seconds`);
      setTimeout(connectToServer, delay);
    });
  } catch (err) {
    console.error("Error creating bot:", err);
    isConnecting = false;
    setTimeout(connectToServer, 30000);
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
  // Clear existing interval if it exists
  if (sleepInterval) {
    clearInterval(sleepInterval);
  }

  sleepInterval = setInterval(async () => {
    if (!bot || goingToSleep || !bot.entity || bot.isSleeping) {
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
  activityInterval = setTimeout(() => {
    performRandomActivity();
    // Re-schedule another activity
    if (bot && bot.entity) {
      scheduleRandomActivity();
    }
  }, delay);
}

function performRandomActivity() {
  if (!bot || !bot.entity || bot.isSleeping || goingToSleep) {
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
    if (!bot || !bot.entity) {
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
    if (!bot || !bot.entity) return;
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
      const position = bot && bot.entity ? `at ${bot.entity.position}` : "";
      res.end(`Bot is alive! Status: ${status} ${position}\n`);
    })
    .listen(PORT, () => {
      console.log(`HTTP Server running on port ${PORT}`);
    });
}

function startSelfPing() {
  const url = process.env.SELF_URL;
  if (!url) {
    console.log("SELF_URL not set in environment. Skipping self-ping setup.");
    return;
  }

  const pingInterval = setInterval(() => {
    fetch(url)
      .then((res) => console.log(`Self-ping success: ${res.status}`))
      .catch((err) => console.log(`Self-ping error: ${err.message}`));
  }, 12 * 60 * 1000);
}

function setupPacketHandler() {
  if (!bot) return;

  bot.on("packet", (data, meta) => {
    if (meta.name === "entity_metadata") {
      try {
        // Handle entity metadata packets more safely
      } catch (err) {
        // Silently handle VarInt parsing errors
        if (err.name === "PartialReadError") {
          return;
        }
        // Log other errors
        console.log("Packet handling error:", meta.name, err.message);
      }
    }
  });
}

createHttpServer();
startSelfPing();
connectToServer();
