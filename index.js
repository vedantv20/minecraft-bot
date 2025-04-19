require("dotenv/config");
const http = require("node:http");
const mineflayer = require("mineflayer");

const { goals } = require("mineflayer-pathfinder");

// Bot reference
let bot = null;
let lastActivity = Date.now();

// Create the bot once when the file runs
bot = mineflayer.createBot({
  host: process.env.host,
  port: parseInt(process.env.port),
  username: process.env.name,
  version: "1.21.4",
  auth: "offline",
  checkTimeoutInterval: 30000,
  hideErrors: false,
});

// Set up event listeners
bot.once("connect", () => {
  console.log(`Connected to ${process.env.host}:${process.env.port}`);
});

bot.once("spawn", () => {
  console.log("Bot successfully spawned in world");
  scheduleRandomActivity();
});

// Error handling
bot.on("error", (err) => {
  console.log(`Connection error: ${err.message}`);
});

bot.on("end", () => {
  console.log("Bot session ended");
});

bot.on("kicked", (reason) => {
  console.log(`Kicked: ${JSON.stringify(reason)}`);
});

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
