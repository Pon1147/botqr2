// index.js - Main Bot File (Sheets-Only Migration with Headers)
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
} = require("discord.js");
const QRCode = require("qrcode");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { google } = require("googleapis"); // For Google Sheets

// Load token
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Lỗi: Không tìm thấy TOKEN trong .env!");
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLES = process.env.ADMIN_ROLES
  ? process.env.ADMIN_ROLES.split(",").map((r) => r.trim())
  : ["Admin"];
const LOGS_DIR = path.join(__dirname, "logs");
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "service-account-key.json"); // Path to JSON key

// Load commands from folder
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

// Logging functions
async function getLogFile() {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const logFile = path.join(LOGS_DIR, `${dateStr}.log`);
  try {
    await require("fs").promises.mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    console.error("Lỗi tạo thư mục logs:", error);
  }
  return logFile;
}

async function logMessage(level, message) {
  const now = new Date();
  const timestamp = now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  try {
    const logFile = await getLogFile();
    await require("fs").promises.appendFile(logFile, logEntry);
    console.log(logEntry.trim());
    await syncLogToSheet(level, message); // Sync to Sheets
  } catch (error) {
    console.error("Lỗi ghi log:", error);
  }
}

// Google Sheets Auth
let sheetsClient = null;

async function authSheets() {
  if (sheetsClient) return sheetsClient;
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_PATH,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    await logMessage("INFO", "Auth Google Sheets success");
    return sheetsClient;
  } catch (error) {
    await logMessage("ERROR", `Auth Sheets fail: ${error.message}`);
    return null;
  }
}

// Data functions (Sheets-Only with Headers)
let userQrData = new Map();
let paymentsData = [];

async function loadQrDataFromSheet() {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) {
    await logMessage("ERROR", "Cannot auth Sheets for QR load");
    return;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_ID,
      range: "QR_Data!A:F",
    });
    const rows = response.data.values || [];
    userQrData.clear();
    // Skip header row (rows[0])
    for (const row of rows.slice(1)) {
      if (row.length >= 6) {
        // Ensure full row including LastUpdated
        const [userId, bank, account, url, logo, lastUpdated] = row;
        userQrData.set(userId, {
          bank: bank || "",
          account: account || "",
          url: url || "",
          logo: logo || "",
        });
      }
    }
    await logMessage(
      "INFO",
      `Loaded QR data from Sheets: ${userQrData.size} users`
    );
  } catch (error) {
    await logMessage("ERROR", `Load QR from Sheets fail: ${error.message}`);
  }
}

async function saveQrDataToSheet() {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) return;

  const values = [];
  for (const [userId, qrObj] of userQrData.entries()) {
    values.push([
      userId,
      qrObj.bank || "",
      qrObj.account || "",
      qrObj.url || "",
      qrObj.logo || "",
      new Date().toISOString(),
    ]);
  }

  try {
    // Clear only data rows (preserve header in row 1)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEETS_ID,
      range: "QR_Data!A2:F",
    });
    if (values.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEETS_ID,
        range: "QR_Data!A2", // Start append from row 2
        valueInputOption: "RAW",
        resource: { values },
      });
    }
    await logMessage("INFO", `Saved ${values.length} QR records to Sheets`);
  } catch (error) {
    await logMessage("ERROR", `Save QR to Sheets fail: ${error.message}`);
  }
}

async function loadPaymentsFromSheet() {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) {
    await logMessage("ERROR", "Cannot auth Sheets for payments load");
    return;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_ID,
      range: "Payments!A:H",
    });
    const rows = response.data.values || [];
    paymentsData = [];
    // Skip header row (rows[0])
    for (const row of rows.slice(1)) {
      if (row.length >= 8) {
        const [
          id,
          buyerId,
          amount,
          description,
          status,
          date,
          processedDate,
          reason,
        ] = row;
        paymentsData.push({
          id,
          buyerId,
          amount: parseFloat(amount) || 0,
          description: description || "",
          status: status || "",
          date: date || "",
          processedDate: processedDate || "",
          reason: reason || "",
        });
      }
    }
    await logMessage(
      "INFO",
      `Loaded payments from Sheets: ${paymentsData.length} transactions`
    );
  } catch (error) {
    await logMessage(
      "ERROR",
      `Load payments from Sheets fail: ${error.message}`
    );
  }
}

function getSortedPayments() {
  return [...paymentsData].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function savePaymentsToSheet(newTx = null) {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) return;

  // For full save, clear data rows and append all (preserve header)
  const allTxs = getSortedPayments();
  const values = allTxs.map((tx) => [
    tx.id || "",
    tx.buyerId || "",
    tx.amount || 0,
    tx.description || "",
    tx.status || "",
    tx.date || "",
    tx.processedDate || "",
    tx.reason || "",
  ]);

  try {
    // Clear only data rows (preserve header in row 1)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEETS_ID,
      range: "Payments!A2:H",
    });
    if (values.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEETS_ID,
        range: "Payments!A2", // Start append from row 2
        valueInputOption: "RAW",
        resource: { values },
      });
    }
    await logMessage("INFO", `Saved ${values.length} payments to Sheets`);
  } catch (error) {
    await logMessage("ERROR", `Save payments to Sheets fail: ${error.message}`);
  }
}

async function syncLogToSheet(level, message) {
  const sheets = await authSheets();
  if (!sheets || !SHEETS_ID) return;

  const values = [[new Date().toISOString(), level, message]];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEETS_ID,
      range: "Logs!A:C",
      valueInputOption: "RAW",
      resource: { values },
    });
  } catch (error) {
    console.error(`Sync log fail: ${error.message}`);
  }
}

// Embed function
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
    .setFooter({ text: "QR Payment Bot" })
    .setThumbnail(logo || null);
}

// Buttons and Modal functions
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

client.once("ready", async () => {
  await logMessage("INFO", `Bot online: ${client.user.tag}`);

  // Load from Sheets instead of files
  await loadQrDataFromSheet();
  await loadPaymentsFromSheet();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    await logMessage("ERROR", `Lỗi: Không tìm thấy guild ID ${GUILD_ID}!`);
    return;
  }

  const commands = [];
  for (const command of client.commands.values()) {
    commands.push(command.data.toJSON());
  }

  try {
    await guild.commands.set(commands);
    await logMessage(
      "INFO",
      `Sync ${commands.length} commands cho guild ${guild.name}`
    );
  } catch (error) {
    await logMessage("ERROR", `Lỗi sync: ${error.message}`);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      // Check admin for admin commands
      const isAdmin =
        interaction.member.permissions.has("Administrator") ||
        ADMIN_ROLES.some((roleName) =>
          interaction.member.roles.cache.some((role) => role.name === roleName)
        );
      if (command.adminOnly && !isAdmin) {
        return interaction.reply({
          content: "Bạn không có quyền admin!",
          ephemeral: true,
        });
      }

      await command.execute(
        interaction,
        userQrData,
        paymentsData,
        saveQrDataToSheet, // Updated callback
        savePaymentsToSheet, // Updated callback
        (msg) => logMessage("INFO", msg),
        QRCode,
        AttachmentBuilder,
        createQrEmbed,
        createEditButtons,
        getSortedPayments
      );
    } catch (error) {
      await logMessage(
        "ERROR",
        `Lỗi execute ${interaction.commandName}: ${error.message}`
      );
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "Có lỗi xảy ra!",
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: "Có lỗi xảy ra!", ephemeral: true });
      }
    }
  } else if (interaction.isButton()) {
    try {
      let { action, userId } = parseCustomId(interaction.customId);
      if (action.startsWith("edit_") || action === "reset") {
        if (interaction.user.id !== userId) {
          return interaction.reply({
            content: "Không phải của bạn!",
            ephemeral: true,
          });
        }

        const qrObj = userQrData.get(userId);
        if (!qrObj)
          return interaction.reply({
            content: "Data không tồn tại!",
            ephemeral: true,
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
            userQrData.delete(userId);
            await saveQrDataToSheet(); // Updated
            await interaction.update({ content: "Đã reset!", components: [] });
            break;
        }
      } else if (action === "prev" || action === "next") {
        // Handle pagination buttons from payment-info (logic in command)
        await interaction.reply({
          content: "Pagination handled in command.",
          ephemeral: true,
        });
      }
    } catch (error) {
      if (error.message === "Invalid customId format") {
        await interaction.reply({
          content: "CustomId không hợp lệ!",
          ephemeral: true,
        });
      } else {
        throw error;
      }
    }
  } else if (interaction.isModalSubmit()) {
    try {
      const { action: modalType, userId } = parseCustomId(interaction.customId);
      const value = interaction.fields.getTextInputValue("input_value");
      const qrObj = userQrData.get(userId);
      if (!qrObj)
        return interaction.reply({
          content: "Data không tồn tại!",
          ephemeral: true,
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
          // Basic URL validation
          try {
            new URL(value.startsWith("http") ? value : "http://" + value);
          } catch {
            return interaction.reply({
              content: "URL không hợp lệ!",
              ephemeral: true,
            });
          }
          qrObj.url = value;
          updated = true;
          break;
      }

      if (updated) {
        userQrData.set(userId, qrObj);
        await saveQrDataToSheet(); // Updated

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
        await interaction.reply({ content: "Lỗi update!", ephemeral: true });
      }
    } catch (error) {
      if (error.message === "Invalid customId format") {
        await interaction.reply({
          content: "CustomId không hợp lệ!",
          ephemeral: true,
        });
      } else {
        await logMessage("ERROR", `Lỗi modal: ${error.message}`);
        await interaction.reply({ content: "Có lỗi xảy ra!", ephemeral: true });
      }
    }
  }
});

client.login(TOKEN);

const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

// Route cơ bản để Render check health
app.get("/", (req, res) => {
  res.send("Bot Discord đang chạy khỏe mạnh!");
});

// Lắng nghe trên port
app.listen(port, () => {
  console.log(`HTTP server đang chạy trên port ${port}`);
});
