require("dotenv").config();

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const path = require("path");
const fs = require("fs");

// Services
const logger = require("./services/logger");
const qrDataService = require("./services/qrDataService");
const paymentService = require("./services/paymentService");
const { getValues, appendValues } = require("./services/googleSheets");

// Utils
const {
  createQrEmbed,
  createEditButtons,
  createEditModal,
  parseCustomId,
} = require("./utils/embedUtils"); // Giả sử bạn đã tạo file này, nếu chưa thì tách tương tự
const {
  loadCapitalFromSheet,
  saveCapitalToSheet,
  capitalData,
} = require("./utils/capitalUtils");

// Config
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Không tìm thấy TOKEN trong .env!");
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLES = process.env.ADMIN_ROLES
  ? process.env.ADMIN_ROLES.split(",").map((r) => r.trim())
  : ["Admin"];
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

// Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, "commands");
function loadCommands(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      loadCommands(fullPath);
    } else if (file.name.endsWith(".js")) {
      const command = require(fullPath);
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded: ${command.data.name}`);
      }
    }
  }
}
loadCommands(commandsPath);

// Config chung truyền cho tất cả events
const config = {
  logger,
  qrDataService,
  paymentService,
  QRCode: require("qrcode"),
  AttachmentBuilder: require("discord.js").AttachmentBuilder,
  EmbedBuilder: require("discord.js").EmbedBuilder,
  ActionRowBuilder: require("discord.js").ActionRowBuilder,
  ButtonBuilder: require("discord.js").ButtonBuilder,
  ButtonStyle: require("discord.js").ButtonStyle,
  ModalBuilder: require("discord.js").ModalBuilder,
  TextInputBuilder: require("discord.js").TextInputBuilder,
  TextInputStyle: require("discord.js").TextInputStyle,
  createQrEmbed,
  createEditButtons,
  createEditModal,
  parseCustomId,
  loadCapitalFromSheet,
  saveCapitalToSheet,
  capitalData,
  getValues,
  appendValues,
  GUILD_ID,
  ADMIN_ROLES,
  SHEETS_ID,
};

// Load events
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) =>
      event.execute(...args, config, client)
    );
  } else {
    client.on(event.name, (...args) => event.execute(...args, config));
  }
}

// Login
client.login(TOKEN);

// Keep-alive
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot đang chạy khỏe mạnh!"));
app.listen(port, () => console.log(`Server chạy trên port ${port}`));
