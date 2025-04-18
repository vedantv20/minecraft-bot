require("dotenv/config");
const http = require("node:http");
const mineflayer = require("mineflayer");
const { initiateServer } = require("./startServer.js");

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
