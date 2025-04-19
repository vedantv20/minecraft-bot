require("dotenv/config");
const http = require("node:http");
const mineflayer = require("mineflayer");
const { initiateServer } = require("./startServer.js");

<<<<<<< HEAD
const Vec3 = require("vec3");
const {
  pathfinder,
  Movements,
  goals: { GoalNear, GoalBlock },
} = require("mineflayer-pathfinder");

// Area Configuration
const MIN_CORNER = new Vec3(-306, 183, -10);
const MAX_CORNER = new Vec3(-297, 185, 1);
const ALLOWED_BLOCKS = [
  "dirt",
  "oak_stairs",
  "cobblestone",
  "cobbled_deepslate",
  "netherrack",
];
=======
const { goals } = require("mineflayer-pathfinder");
>>>>>>> 743bdf9 (clean up pathfinding library)

// Bot reference
let bot = null;
let reconnectInterval = null;
let isConnected = false;

// Global state
let goingToSleep = false;
let bedLocation = null;
let lastActivity = Date.now();
let isPlacingBed = false;
let isMining = false;
let isPlacingBlock = false;

// Initial bot creation
createBot();

<<<<<<< HEAD
// Function to create a new bot instance
function createBot() {
  // Clean up any existing bot and interval
  destroyBot();

  console.log(
    `Creating bot and connecting to ${process.env.host}:${process.env.port}`
  );

  bot = mineflayer.createBot({
    host: process.env.host,
    port: parseInt(process.env.port),
    username: process.env.name,
    version: "1.21.4",
    auth: "offline",
    checkTimeoutInterval: 30000,
    hideErrors: false,
  });
=======
// Set up event listeners
bot.once("connect", () => {
  console.log(`Connected to ${process.env.host}:${process.env.port}`);
});

bot.once("spawn", () => {
  console.log("Bot successfully spawned in world");
  scheduleRandomActivity();
});
>>>>>>> 743bdf9 (clean up pathfinding library)

  // Load plugins
  bot.loadPlugin(pathfinder);

  // Set up event listeners
  bot.once("connect", () => {
    console.log(`Connected to ${process.env.host}:${process.env.port}`);
  });

  bot.once("spawn", () => {
    console.log("Bot successfully spawned in world");
    isConnected = true;
    setupPathfinder();
    handleSleep();
    scheduleRandomActivity();
  });

<<<<<<< HEAD
  // Error handling
  bot.on("error", (err) => {
    console.log(`Connection error: ${err.message}`);
    handleDisconnect();
  });

  bot.on("end", () => {
    console.log("Bot session ended");
    handleDisconnect();
  });

  bot.on("kicked", (reason) => {
    console.log(`Kicked: ${JSON.stringify(reason)}`);
    handleDisconnect();
  });
}

// Clean up existing bot
function destroyBot() {
  if (bot && bot._client) {
    try {
      bot._client.end();
      bot.removeAllListeners();
      console.log("Cleaned up previous bot instance");
    } catch (e) {
      console.log("Error cleaning up previous bot:", e.message);
    }
  }
  bot = null;
}

// Handle disconnection and reconnection
function handleDisconnect() {
  isConnected = false;
  goingToSleep = false;

  // Clean up any existing reconnect interval
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }

  console.log("Setting up reconnection attempts every 2 minutes...");
  reconnectInterval = setInterval(() => {
    if (!isConnected) {
      console.log("Attempting to reconnect to server...");
      createBot();
    } else {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  }, 2 * 60 * 1000); // 2 minutes

  // Also try to reconnect immediately for the first attempt
  setTimeout(createBot, 5000);
}

// The rest of your existing functions remain unchanged
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

// Keep all your existing functions for findAndPlaceBed, attemptSleep, handleSleep, etc.
// ...
=======
// Activities System
function scheduleRandomActivity() {
  // More human-like variable timing between 10-30 seconds
  let delay = Math.floor(Math.random() * (30000 - 10000 + 1)) + 10000;

  // Check for inactivity - if no activity for 2 minutes, force an action sooner
  if (Date.now() - lastActivity > 120000) {
    delay = 5000; // Force activity sooner
    console.log("Bot has been idle too long, scheduling activity soon");
  }

  setTimeout(() => {
    if (!bot) return;
    performRandomActivity();
    scheduleRandomActivity();
  }, delay);
}

function performRandomActivity() {
  // Only keep chat, jump, and move activities
  const actions = [doRandomChat, doRandomJump, doRandomMove];

  try {
    const randomAction = actions[Math.floor(Math.random() * actions.length)];
    randomAction();
    lastActivity = Date.now();
  } catch (err) {
    console.log(`Error in performRandomActivity: ${err.message}`);
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
    // More natural jumping pattern - sometimes single jumps, sometimes multiple
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

    // Calculate target orientation
    const currentYaw = bot.entity.yaw;
    let targetYaw = currentYaw + yawOffset;

    // Normalize yaw to [-π, π]
    targetYaw = ((targetYaw + Math.PI) % (Math.PI * 2)) - Math.PI;

    // Add some randomness to walking duration for more human-like behavior
    const walkDuration = Math.floor(Math.random() * 3000) + 1000; // 1-4 seconds
    console.log(`Bot moving ${dir} for ${walkDuration}ms`);

    // Face direction first
    bot
      .look(targetYaw, 0, false)
      .then(() => {
        // Move forward after facing direction
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
>>>>>>> 743bdf9 (clean up pathfinding library)

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
