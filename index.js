require("dotenv/config");
const mineflayer = require("mineflayer");
const http = require("http");
const fetch = require("node-fetch");

const bot = mineflayer.createBot({
  host: process.env.host,
  port: parseInt(process.env.port),
  username: process.env.name,
  version: "1.21.4",
  auth: "offline",
  checkTimeoutInterval: 30000,
  hideErrors: false,
});

bot.once("connect", () => {
  console.log(`Connecting to ${process.env.host}:${process.env.port}`);
});

bot.once("spawn", () => {
  console.log("Bot successfully spawned in world");
  handleSleep();
});

bot.on("error", (err) => {
  console.log(`Connection error: ${err.message}`);
  bot.end();
});

bot.on("end", () => {
  console.log("Reconnecting");
});

bot.on("kicked", (reason) => {
  console.log(`Kicked: ${JSON.stringify(reason)}`);
});

function handleSleep() {
  setInterval(() => {
    if (!bot) return;
    const dayTime = bot.time.timeOfDay;

    if (dayTime >= 13000 && dayTime <= 23000) {
      if (!bot.isSleeping) {
        const bed = bot.findBlock({
          matching: (block) => bot.isABed(block),
          maxDistance: 9,
        });

        if (bed) {
          console.log("Bed found at:", bed.position);
          bot
            .sleep(bed)
            .then(() => {
              console.log("Bot is now sleeping.");
            })
            .catch((err) => {
              console.log("Could not sleep:", err.message);
            });
        } else {
          console.log("No bed found nearby.");
        }
      }
    }
  }, 20000);
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
