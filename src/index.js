// src/index.js - Entry point chính của bot Discord
// Production-ready cho Railway Worker (no HTTP keep-alive needed)

console.log('[BOOT] Process starting - PID:', process.pid);
console.log('[BOOT] Node version:', process.version);
console.error('[BOOT-TEST] Test stderr output - should appear in logs');

// Catch uncaught errors để tránh silent crash
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught Exception:', err.stack || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[REJECTION] Unhandled Rejection at:', promise, 'reason:', reason.stack || reason);
});

require("dotenv").config();

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const path = require("path");
const fs = require("fs");

// Import config
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
const categoriesService = require("./services/categoriesService");
const subItemsService = require("./services/subItemsService");

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

// Khởi tạo client - thêm intents cần thiết cho slash commands và interactions
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Thêm nếu cần: GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent (cho prefix commands)
  ],
});
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
        console.log(`[CMD] Loaded: ${command.data.name}`);
      } else {
        console.warn(`[WARNING] Command tại ${fullPath} thiếu data/execute`);
      }
    }
  }
}

loadCommands(commandsPath);
console.log(`[CMD] Total commands loaded: ${client.commands.size}`);

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
  categoriesService,
  subItemsService,
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
      event.execute(...args, eventConfig, client),
    );
  } else {
    client.on(event.name, (...args) => event.execute(...args, eventConfig));
  }
}

console.log(`[EVENT] Loaded ${eventFiles.length} events`);

// ── Login ──
console.log('[LOGIN] Attempting login...');
client.login(config.TOKEN)
  .then(() => {
    console.log('[LOGIN] Success - Bot logged in as', client.user.tag);
  })
  .catch((err) => {
    console.error('[LOGIN] Failed:', err.message || err);
    process.exit(1);
  });

// ────────────────────────────────────────────────────────────────
// PHẦN BỊ THAY THẾ / XÓA (không cần trên Railway Worker service)
// ────────────────────────────────────────────────────────────────
// Lý do xóa: Railway Worker không sleep theo traffic, không cần HTTP keep-alive.
// Nếu dùng Render free tier thì mới cần phần này, nhưng hiện tại deploy Railway nên loại bỏ.

// const express = require("express");
// const app = express();
// app.get("/", (req, res) => res.send("Bot Discord đang chạy khỏe mạnh!"));
// app.listen(config.PORT, () => {
//   console.log(`Keep-alive server chạy trên port ${config.PORT}`);
// });

// const https = require('https');
// setInterval(() => {
//   const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || 'botqr2.onrender.com';
//   const url = `https://${hostname}/`;
//   https.get(url, (res) => {
//     console.log(`Self-ping thành công: ${res.statusCode} - ${new Date().toISOString()}`);
//   }).on('error', (err) => {
//     console.error('Self-ping lỗi:', err.message);
//   });
// }, 10 * 60 * 1000);  // 10 phút