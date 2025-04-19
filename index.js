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

// Area Configuration
const MIN_CORNER = new Vec3(-306, 183, -14);
const MAX_CORNER = new Vec3(-297, 185, -4);
let bot = null;
let goingToSleep = false;
let lastActivity = Date.now();
let serverCheckAttempts = 0;

async function checkServer() {
  const server = await initiateServer();
  serverCheckAttempts++;
  if (!server || !server.success) {
    console.log("server error:", server?.error);
    if (serverCheckAttempts < 5) {
      console.log("retrying to initiate the server");
      checkServer();
    }
    console.log("stopping server initiation.");
    return;
  } else {
    serverCheckAttempts = 0;
    console.log("Bot will join server in few seconds");
    setTimeout(createBot, 15000);
  }
}

function createBot() {
  bot = mineflayer.createBot({
    host: process.env.host,
    port: parseInt(process.env.port),
    username: process.env.name,
    version: "1.21.4",
    auth: "offline",
    checkTimeoutInterval: 60000,
    connectTimeout: 30000,
    keepAlive: true,
  });

  bot.loadPlugin(pathfinder);

  bot.once("spawn", () => {
    console.log("Bot spawned!");
    setupPathfinder();
    handleSleep();
    scheduleRandomActivity();
  });

  bot.on("error", (err) => console.log("Bot error:", err));
  bot.on("kicked", (reason) => {
    console.log(`Kicked: ${JSON.stringify(reason)}`);
    checkServer();
  });
  bot.on("end", (err) => {
    console.log("Bot has disconnected from the server");
    checkServer();
  });
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
  setInterval(async () => {
    if (!bot || goingToSleep) return;

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
  const maxDelay = 120 * 10000;
  const minDelay = 60 * 10000;

  let delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  if (Date.now() - lastActivity > 120000) {
    delay = 5000;
    console.log("Idle too long, triggering activity.");
  }

  setTimeout(() => {
    if (!bot) return;
    performRandomActivity();
    scheduleRandomActivity();
  }, delay);
}

function performRandomActivity() {
  if (bot.isSleeping || goingToSleep) return;

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
  const jumps = Math.floor(Math.random() * 3) + 1;
  let count = 0;
  const jumpInterval = setInterval(() => {
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 300);
    count++;
    if (count >= jumps) clearInterval(jumpInterval);
  }, 600);
}

function doRandomMove() {
  const directions = ["forward", "back", "left", "right"];
  const dir = directions[Math.floor(Math.random() * directions.length)];
  const duration = Math.floor(Math.random() * 3000) + 1000;

  bot.setControlState(dir, true);
  setTimeout(() => {
    bot.setControlState(dir, false);
    console.log(`Moved ${dir} for ${duration}ms`);
  }, duration);
}

function createHttpServer() {
  const PORT = process.env.server_port || 3000;
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Bot is alive!\n");
    })
    .listen(PORT, () => {
      console.log(`HTTP Server running on port ${PORT}`);
    });
}

function startSelfPing() {
  const url = process.env.SELF_URL;

  setInterval(() => {
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
