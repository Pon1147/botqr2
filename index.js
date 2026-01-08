// index.js - Main Bot File (Refactored with qrDataService & paymentService)
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const QRCode = require("qrcode");
const path = require("path");

// Services
const logger = require("./src/services/logger");
const {
  getValues,
  clearRange,
  appendValues,
} = require("./src/services/googleSheets");
const qrDataService = require("./src/services/qrDataService");
const paymentService = require("./src/services/paymentService");

// Configs
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Lỗi: Không tìm thấy TOKEN trong .env!");
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLES = process.env.ADMIN_ROLES
  ? process.env.ADMIN_ROLES.split(",").map((r) => r.trim())
  : ["Admin"];
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "service-account-key.json");

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = require("fs")
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.data.name, command);
}

// Global data (chỉ còn capital tạm thời)
let capitalData = 0;

// Google Sheets client
let sheetsClient = null;

async function authSheets() {
  if (sheetsClient) return sheetsClient;
  try {
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_PATH,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    await logger.info("Auth Google Sheets success", SHEETS_ID);
    return sheetsClient;
  } catch (error) {
    await logger.error(`Auth Sheets fail: ${error.message}`, SHEETS_ID);
    return null;
  }
}

// Capital
async function loadCapitalFromSheet() {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) return;

  try {
    const rows = await getValues(SHEETS_ID, "Capital!A:B");
    if (rows.length > 1) {
      const latestRow = rows[rows.length - 1];
      capitalData = parseFloat(latestRow[1]) || 0;
    }
    await logger.info(
      `Loaded capital from Sheets: ${capitalData.toLocaleString()} VNĐ`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(
      `Load capital from Sheets fail: ${error.message}`,
      SHEETS_ID
    );
  }
}

async function saveCapitalToSheet(amount) {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) return;

  const values = [[new Date().toISOString(), amount]];

  try {
    await appendValues(SHEETS_ID, "Capital!A:B", values);
    capitalData = amount;
    await logger.info(
      `Saved capital ${amount.toLocaleString()} VNĐ to Sheets`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(
      `Save capital to Sheets fail: ${error.message}`,
      SHEETS_ID
    );
  }
}

// Utils
function createQrEmbed(qrObj, attachment) {
  const { bank, account, url, logo } = qrObj;
  return new EmbedBuilder()
    .setColor(0xe0f7fa)
    .addFields(
      { name: "Tên Chủ Tài Khoản", value: bank || "Chưa set", inline: false },
      { name: "Số Tài Khoản", value: account || "Chưa set", inline: false },
      { name: "Mã QR", value: "\u200B", inline: false }
    )
    .setImage("attachment://my_qr.png")
    .setTimestamp()
    .setFooter({
      text: "Vui lòng kiểm tra thật kỹ khi chuyển khoản và gửi bill sau khi thanh toán thành công ",
    })
    .setThumbnail(logo || null);
}

function createEditButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`edit_bank_${userId}`)
      .setLabel("Edit Tên/Chủ TK")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`edit_account_${userId}`)
      .setLabel("Edit Số TK")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`edit_url_${userId}`)
      .setLabel("Edit URL/QR")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reset_${userId}`)
      .setLabel("Reset All")
      .setStyle(ButtonStyle.Danger)
  );
}

function createEditModal(customId, title, placeholder) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("input_value")
          .setLabel(title)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(placeholder)
          .setRequired(true)
      )
    );
}

function parseCustomId(customId) {
  const match = customId.match(/^(.+)_(\d+)$/);
  if (!match) throw new Error("Invalid customId format");
  return { action: match[1], userId: match[2] };
}

// Client Ready
client.once("clientReady", async () => {
  await logger.info(`Bot online: ${client.user.tag}`, SHEETS_ID);

  await qrDataService.loadQrDataFromSheet(SHEETS_ID);
  await paymentService.loadPaymentsFromSheet(SHEETS_ID);
  await loadCapitalFromSheet();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    await logger.error(`Không tìm thấy guild ID ${GUILD_ID}!`, SHEETS_ID);
    return;
  }

  const commands = [];
  for (const command of client.commands.values()) {
    commands.push(command.data.toJSON());
  }

  try {
    await guild.commands.set(commands);
    await logger.info(
      `Sync ${commands.length} commands cho guild ${guild.name}`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(`Lỗi sync commands: ${error.message}`, SHEETS_ID);
  }
});

// Interaction Create
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      const isAdmin =
        interaction.member.permissions.has("Administrator") ||
        ADMIN_ROLES.some((roleName) =>
          interaction.member.roles.cache.some((role) => role.name === roleName)
        );

      if (command.adminOnly && !isAdmin) {
        return interaction.reply({
          content: "Bạn không có quyền admin!",
          flags: MessageFlags.Ephemeral,
        });
      }

      await command.execute(
        interaction,
        qrDataService,
        paymentService, // Thay paymentsData + savePaymentsToSheet
        logger,
        QRCode,
        AttachmentBuilder,
        createQrEmbed,
        createEditButtons,
        paymentService.getSortedPayments, // Thay getSortedPayments()
        loadCapitalFromSheet,
        saveCapitalToSheet,
        capitalData
      );
    } catch (error) {
      await logger.error(
        `Lỗi execute ${interaction.commandName}: ${error.message}`,
        SHEETS_ID
      );
      const errorMsg = {
        content: "Có lỗi xảy ra!",
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMsg);
        } else {
          await interaction.reply(errorMsg);
        }
      } catch (apiError) {
        console.error("Lỗi gửi error message:", apiError.message);
      }
    }
  } else if (interaction.isButton()) {
    try {
      let { action, userId } = parseCustomId(interaction.customId);
      if (action.startsWith("edit_") || action === "reset") {
        if (interaction.user.id !== userId) {
          return interaction.reply({
            content: "Không phải của bạn!",
            flags: MessageFlags.Ephemeral,
          });
        }

        const qrObj = qrDataService.getQr(userId);
        if (!qrObj)
          return interaction.reply({
            content: "Data không tồn tại!",
            flags: MessageFlags.Ephemeral,
          });

        let modal;
        switch (action) {
          case "edit_bank":
            modal = createEditModal(
              `modal_bank_${userId}`,
              "Edit Tên Chủ TK",
              qrObj.bank
            );
            await interaction.showModal(modal);
            break;
          case "edit_account":
            modal = createEditModal(
              `modal_account_${userId}`,
              "Edit Số Tài Khoản",
              qrObj.account
            );
            await interaction.showModal(modal);
            break;
          case "edit_url":
            modal = createEditModal(
              `modal_url_${userId}`,
              "Edit URL/QR",
              qrObj.url
            );
            await interaction.showModal(modal);
            break;
          case "reset":
            qrDataService.deleteQr(userId);
            await qrDataService.saveQrDataToSheet(SHEETS_ID);
            await interaction.update({ content: "Đã reset!", components: [] });
            break;
        }
      } else if (action === "prev" || action === "next") {
        await interaction.reply({
          content: "Pagination handled in command.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      if (error.message === "Invalid customId format") {
        await interaction.reply({
          content: "CustomId không hợp lệ!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await logger.error(`Lỗi button handler: ${error.message}`, SHEETS_ID);
        throw error;
      }
    }
  } else if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith("capital_modal_")) return;

      const { action: modalType, userId } = parseCustomId(interaction.customId);
      const value = interaction.fields.getTextInputValue("input_value");
      const qrObj = qrDataService.getQr(userId);
      if (!qrObj)
        return interaction.reply({
          content: "Data không tồn tại!",
          flags: MessageFlags.Ephemeral,
        });

      let updated = false;
      switch (modalType) {
        case "modal_bank":
          qrObj.bank = value;
          updated = true;
          break;
        case "modal_account":
          qrObj.account = value;
          updated = true;
          break;
        case "modal_url":
          try {
            new URL(value.startsWith("http") ? value : "http://" + value);
          } catch {
            return interaction.reply({
              content: "URL không hợp lệ!",
              flags: MessageFlags.Ephemeral,
            });
          }
          qrObj.url = value;
          updated = true;
          break;
      }

      if (updated) {
        qrDataService.setQr(userId, qrObj);
        await qrDataService.saveQrDataToSheet(SHEETS_ID);

        const qrBuffer = await QRCode.toBuffer(qrObj.url, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });
        const attachment = new AttachmentBuilder(qrBuffer, {
          name: "my_qr.png",
        });
        const embed = createQrEmbed(qrObj, attachment);
        const components = [createEditButtons(userId)];

        await interaction.update({
          embeds: [embed],
          files: [attachment],
          components,
        });
      } else {
        await interaction.reply({
          content: "Lỗi update!",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      if (error.message === "Invalid customId format") {
        await interaction.reply({
          content: "CustomId không hợp lệ!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await logger.error(`Lỗi modal submit: ${error.message}`, SHEETS_ID);
        await interaction.reply({
          content: "Có lỗi xảy ra!",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
});

// Login
client.login(TOKEN);

// HTTP keep-alive
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot Discord đang chạy khỏe mạnh!");
});

app.listen(port, () => {
  console.log(`HTTP server đang chạy trên port ${port}`);
});
