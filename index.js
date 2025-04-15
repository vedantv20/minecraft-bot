require("dotenv/config");
const mineflayer = require("mineflayer");

const bot = mineflayer.createBot({
  host: "minecrafter191.aternos.me",
  port: 37502,
  username: "AFK_bot",
  version: "1.21.4",
});

bot.on("chat", function (username, message) {
  if (username === bot.username) return;
  bot.chat(message || "this is a message by a bot");
});

bot.on("spawn", () => console.log("Bot joined the game."));
bot.on("kicked", (reason, loggedIn) => console.log(reason, loggedIn));
bot.on("error", (err) => console.log(err));
