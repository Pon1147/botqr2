// src/index.js - Entry point chính của bot Discord
require("dotenv").config();

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const path = require("path");
const fs = require("fs");

// Import config từ thư mục con config/ (đúng đường dẫn)
const config = require("./config");
const { requiredEnv } = require("./config");

// Kiểm tra biến môi trường bắt buộc
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Thiếu biến môi trường bắt buộc: ${missing.join(", ")}`);
  process.exit(1);
}

// Services
const logger = require("./services/logger");
const qrDataService = require("./services/qrDataService");
const paymentService = require("./services/paymentService");

// Utils
const {
  createQrEmbed,
  createEditButtons,
  createEditModal,
  parseCustomId,
} = require("./utils/embedUtils");
const {
  loadCapitalFromSheet,
  saveCapitalToSheet,
  capitalData,
} = require("./utils/capitalUtils");

// Khởi tạo client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// ── Load commands recursive từ src/commands ──
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
      } else {
        console.warn(`[WARNING] Command tại ${fullPath} thiếu data/execute`);
      }
    }
  }
}

loadCommands(commandsPath);

// ── Object config truyền cho tất cả events ──
const eventConfig = {
  ...config,
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
  getValues: require("./services/googleSheets").getValues,
  appendValues: require("./services/googleSheets").appendValues,
};

// ── Load events tự động từ src/events ──
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));

  if (event.once) {
    client.once(event.name, (...args) =>
      event.execute(...args, eventConfig, client)
    );
  } else {
    client.on(event.name, (...args) => event.execute(...args, eventConfig));
  }
}

// ── Login ──
client.login(config.TOKEN).catch((err) => {
  console.error("Login thất bại:", err.message);
  process.exit(1);
});

// ── Keep-alive server ──
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Bot Discord đang chạy khỏe mạnh!"));
app.listen(config.PORT, () => {
  console.log(`Keep-alive server chạy trên port ${config.PORT}`);
});
