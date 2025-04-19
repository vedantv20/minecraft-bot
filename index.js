require("dotenv/config");
const http = require("node:http");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const Vec3 = require("vec3").Vec3;
const { initiateServer } = require("./server.js");

let bot = null;
let isConnected = false;

// Global state
let goingToSleep = false;
let lastActivity = Date.now();
let isPlacingBed = false;

serverCheckAttempts = 0;
async function checkServer() {
  const server = await initiateServer();
  ++serverCheckAttempts;
  if (!server || !server.success) {
    console.log("server error:", server.error);
    if (serverCheckAttempts < 5) {
      console.log("retrying to initiate the server");
      checkServer();
    }
    console.log("stopping server initiation.");
    return null;
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
    checkTimeoutInterval: 60000, // Increase from 30000 to 60000
    hideErrors: false,
    connectTimeout: 30000, // Add explicit connect timeout
    keepAlive: true, // Ensure keep-alive packets are sent
  });

  bot.loadPlugin(pathfinder);
  bot.once("spawn", () => {
    console.log("Bot successfully spawned in world");
    scheduleRandomActivity();
  });

  // Set up event listeners
  bot.once("connect", () => {
    console.log(`Connected to ${process.env.host}:${process.env.port}`);
  });

  bot.once("spawn", () => {
    console.log("Bot successfully spawned in world");
    isConnected = true;
    handleSleep();
    scheduleRandomActivity();
  });

  bot.on("error", (err) => console.log("Bot error:", err));

  // Handle chat messages from other players
  bot.on("chat", (username, message) => {
    // Ignore messages from the bot itself
    if (username === bot.username) return;

    console.log(`${username}: ${message}`);

    // Simple command handling
    if (message.toLowerCase() === "hello") {
      bot.chat(`Hello, ${username}!`);
    } else if (message.toLowerCase() === "jump") {
      doRandomJump();
      bot.chat("Jumping!");
    } else if (message.toLowerCase() === "spin") {
      doRandomSpin();
    }
  });
}

// Add this constant near the top with other requires
const ALLOWED_BED_POSITIONS = [
  new Vec3(-302, 182, -6),
  new Vec3(-304, 182, -6),
  new Vec3(-299, 182, -6),
  new Vec3(-299, 182, -10),
  new Vec3(-302, 182, -10),
  new Vec3(-305, 182, -11),
];

// Updated validation function
function isValidBedPosition(pos) {
  try {
    const baseBlock = bot.blockAt(pos);
    const headBlock = bot.blockAt(pos.offset(1, 0, 0));
    const floorBlock = bot.blockAt(pos.offset(0, -1, 0));

    return (
      baseBlock.name === "air" &&
      headBlock.name === "air" &&
      floorBlock &&
      floorBlock.boundingBox === "block"
    );
  } catch (err) {
    return false;
  }
}

// Complete updated handleSleep function
async function handleSleep() {
  setInterval(async () => {
    if (!bot || goingToSleep) return;

    goingToSleep = true;
    const dayTime = bot.time.timeOfDay;

    if (dayTime >= 13000 && dayTime <= 23000) {
      try {
        // Check for existing complete bed first
        const beds = bot.findBlocks({
          matching: (block) => bot.isABed(block),
          maxDistance: 9,
          count: 2,
        });

        if (beds.length === 2) {
          const primaryBed = beds[0];
          console.log("Full bed found at:", primaryBed.position);

          // Move to interaction position
          const moveTo = primaryBed.position.offset(0, 0, 1);
          await bot.pathfinder.goto(
            new goals.GoalNear(moveTo.x, moveTo.y, moveTo.z, 1)
          );

          // Face bed correctly
          await bot.lookAt(primaryBed.position.offset(0.5, 0.5, 0.5));

          // Verify bed integrity
          const bedBlock1 = bot.blockAt(primaryBed.position);
          const bedBlock2 = bot.blockAt(beds[1].position);

          if (bot.isABed(bedBlock1) && bot.isABed(bedBlock2)) {
            await bot.sleep(primaryBed);
            console.log("Successfully sleeping in bed");
            lastActivity = Date.now();
          } else {
            console.log("Bed structure broken - cannot sleep");
          }
        } else {
          console.log("No complete bed found nearby, checking inventory...");

          // Check inventory for beds
          const bedItem = bot.inventory
            .items()
            .find((item) => item.name.endsWith("_bed"));

          if (bedItem) {
            console.log("Found bed in inventory, attempting to place...");
            let placed = false;

            // Try allowed positions in sequence
            for (const placePosition of ALLOWED_BED_POSITIONS) {
              try {
                if (!isValidBedPosition(placePosition)) {
                  console.log(`Position ${placePosition} invalid, skipping`);
                  continue;
                }

                // Navigate to placement area
                await bot.pathfinder.goto(
                  new goals.GoalNear(
                    placePosition.x,
                    placePosition.y,
                    placePosition.z,
                    2
                  )
                );

                await bot.lookAt(placePosition.plus(new Vec3(0.5, 0, 0.5)));
                await bot.equip(bedItem, "hand");

                const referenceBlock = bot.blockAt(
                  placePosition.offset(0, -1, 0)
                ); // Place on top of this
                const faceVector = new Vec3(0, 1, 0); // Place on top

                await bot.placeBlock(referenceBlock, faceVector);

                console.log("Bed placed successfully at:", placePosition);
                placed = true;

                // Verify placement
                await new Promise((resolve) => setTimeout(resolve, 2000));
                const placedBeds = bot.findBlocks({
                  matching: (block) => bot.isABed(block),
                  maxDistance: 3,
                  count: 2,
                });

                if (placedBeds.length === 2) {
                  setTimeout(handleSleep, 3000);
                  break;
                }
              } catch (placeError) {
                console.log(
                  `Failed placement at ${placePosition}:`,
                  placeError.message
                );
              }
            }

            if (!placed) {
              console.log("Failed all placement attempts");
              bot.chat("My designated bed spots are blocked!");
            }
          } else {
            console.log("No bed in inventory");
            bot.chat("Please give me a bed!");
          }
        }
      } catch (err) {
        console.log("Sleep error:", err.message);
      } finally {
        goingToSleep = false;
      }
    }
  }, 30000);
}
function scheduleRandomActivity() {
  let delay = Math.floor(Math.random() * (30000 - 10000 + 1)) + 10000;

  if (Date.now() - lastActivity > 120000) {
    delay = 5000;
    console.log("Bot has been idle too long, scheduling activity soon");
  }

  setTimeout(() => {
    if (!bot) return;
    performRandomActivity();
    scheduleRandomActivity();
  }, delay);
}

function performRandomActivity() {
  if (bot.isSleeping || goingToSleep) {
    console.log("Skipping activity - bot is sleeping");
    return;
  }
  const activities = [doRandomChat, doRandomJump, doRandomMove];

  try {
    const randomActivity =
      activities[Math.floor(Math.random() * activities.length)];
    if (!goingToSleep) {
      randomActivity();
      lastActivity = Date.now();
    } else {
      console.log("Bot is going to sleep, avoiding current activity");
    }
  } catch (err) {
    console.log(`Error in performing an activity: ${err.message}`);
  }
}

function doRandomChat() {
  const messages = [
    "Hello there!",
    "Beautiful day in Minecraft!",
    "Just exploring around",
    "This area looks nice",
    "Anyone online?",
    "Having fun in the game",
  ];
  try {
    bot.chat(messages[Math.floor(Math.random() * messages.length)]);
    console.log("Bot sent a chat message");
  } catch (err) {
    console.log(`Chat error: ${err.message}`);
  }
}

function doRandomJump() {
  console.log("Bot performed a jump");
  try {
    const jumps = Math.floor(Math.random() * 3) + 1;
    let count = 0;
    const jumpInterval = setInterval(() => {
      try {
        bot.setControlState("jump", true);
        setTimeout(() => {
          try {
            bot.setControlState("jump", false);
          } catch (e) {
            console.log(`Error ending jump: ${e.message}`);
          }
        }, 300);
      } catch (e) {
        console.log(`Error setting jump: ${e.message}`);
      }

      if (++count >= jumps) clearInterval(jumpInterval);
    }, 1000);
  } catch (err) {
    console.log(`Jump error: ${err.message}`);
  }
}

function doRandomMove() {
  const directions = ["forward", "back", "left", "right"];
  const dir = directions[Math.floor(Math.random() * 4)];

  try {
    // Calculate target yaw based on direction
    let yawOffset = 0;
    switch (dir) {
      case "back":
        yawOffset = Math.PI; // 180 degrees
        break;
      case "left":
        yawOffset = Math.PI / 2; // 90 degrees left
        break;
      case "right":
        yawOffset = -Math.PI / 2; // 90 degrees right
        break;
      // forward remains 0
    }

    const currentYaw = bot.entity.yaw;
    let targetYaw = currentYaw + yawOffset;

    targetYaw = ((targetYaw + Math.PI) % (Math.PI * 2)) - Math.PI;

    const walkDuration = Math.floor(Math.random() * 3000) + 1000; // 1-4 seconds
    console.log(`Bot moving ${dir} for ${walkDuration}ms`);

    bot
      .look(targetYaw, 0, false)
      .then(() => {
        bot.setControlState("forward", true);
        setTimeout(() => {
          try {
            bot.setControlState("forward", false);
          } catch (e) {
            console.log(`Error stopping movement: ${e.message}`);
          }
        }, walkDuration);
      })
      .catch((err) => {
        console.log("Turn error:", err.message);
      });
  } catch (err) {
    console.log(`Move error: ${err.message}`);
  }
}

function doRandomSpin() {
  console.log("Bot is spinning around");
  try {
    let currentRotation = 0;
    const spinInterval = setInterval(() => {
      if (currentRotation >= Math.PI * 2) {
        clearInterval(spinInterval);
        return;
      }
      currentRotation += Math.PI / 8;
      bot.look(currentRotation, 0, false);
    }, 200);
    bot.chat("Spinning around!");
  } catch (err) {
    console.log(`Spin error: ${err.message}`);
  }
}

// Start HTTP server and self-ping functions remain unchanged
function startHttpServer() {
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

startHttpServer();
startSelfPing();
checkServer();
