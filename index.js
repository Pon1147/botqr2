// index.js - Main Bot File (Fixed interaction handling - 2026)
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
const fs = require("fs");

// Services
const logger = require("./src/services/logger");
const {
  getValues,
  clearRange,
  appendValues,
} = require("./src/services/googleSheets");
const qrDataService = require("./src/services/qrDataService");
const paymentService = require("./src/services/paymentService");

// Config & Env
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

// Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Load commands recursive
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
        console.log(`Loaded command: ${command.data.name} from ${fullPath}`);
      } else {
        console.warn(`[WARNING] Command at ${fullPath} missing data/execute`);
      }
    }
  }
}

const commandsPath = path.join(__dirname, "commands");
loadCommands(commandsPath);

// Utils functions
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

// Google Sheets auth (singleton)
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

// Capital global
let capitalData = 0;
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
      `Loaded capital: ${capitalData.toLocaleString()} VNĐ`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(`Load capital fail: ${error.message}`, SHEETS_ID);
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
      `Saved capital ${amount.toLocaleString()} VNĐ`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(`Save capital fail: ${error.message}`, SHEETS_ID);
  }
}

// Ready event
client.once("clientReady", async () => {
  await logger.info(`Bot online: ${client.user.tag}`, SHEETS_ID);

  await qrDataService.loadQrDataFromSheet(SHEETS_ID);
  await paymentService.loadPaymentsFromSheet(SHEETS_ID);
  await loadCapitalFromSheet();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    await logger.error(`Guild ${GUILD_ID} not found!`, SHEETS_ID);
    return;
  }

  const commands = Array.from(client.commands.values()).map((cmd) =>
    cmd.data.toJSON()
  );
  try {
    await guild.commands.set(commands);
    await logger.info(
      `Synced ${commands.length} commands to guild ${guild.name}`,
      SHEETS_ID
    );
  } catch (error) {
    await logger.error(`Sync commands error: ${error.message}`, SHEETS_ID);
  }
});

// ==================== INTERACTION HANDLER - ĐÃ SỬA TRIỆT ĐỂ ====================
client.on("interactionCreate", async (interaction) => {
  const config = {
    qrDataService,
    paymentService,
    logger,
    QRCode,
    AttachmentBuilder,
    createQrEmbed,
    createEditButtons,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    capitalData,
    SHEETS_ID,
  };

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      // Kiểm tra quyền admin
      const isAdmin =
        interaction.member.permissions.has("Administrator") ||
        ADMIN_ROLES.some((roleName) =>
          interaction.member.roles.cache.some((r) => r.name === roleName)
        );

      if (command.adminOnly && !isAdmin) {
        return interaction.reply({
          content: "Bạn không có quyền admin!",
          ephemeral: true,
        });
      }

      // DEFER DUY NHẤT MỘT LẦN Ở ĐÂY - các lệnh KHÔNG ĐƯỢC defer/reply nữa
      await interaction.deferReply({ ephemeral: command.ephemeral ?? false });

      // Execute lệnh - lệnh chỉ được dùng editReply / followUp
      await command.execute(interaction, config);
    } catch (error) {
      await logger.error(
        `Execute ${interaction.commandName} error: ${error.message}\nStack: ${error.stack}`,
        SHEETS_ID
      );

      const errorMsg = {
        content: "Có lỗi xảy ra khi thực thi lệnh!",
        ephemeral: true,
      };

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorMsg);
        } else {
          await interaction.reply(errorMsg);
        }
      } catch (followUpError) {
        console.error("Không thể gửi error message:", followUpError.message);
      }
    }
  } else if (interaction.isButton()) {
    // Giữ nguyên logic button (đã ổn)
    try {
      const { action, userId } = parseCustomId(interaction.customId);

      if (action.startsWith("edit_") || action === "reset") {
        if (interaction.user.id !== userId) {
          return interaction.reply({
            content: "Không phải của bạn!",
            ephemeral: true,
          });
        }

        const qrObj = qrDataService.getQr(userId);
        if (!qrObj)
          return interaction.reply({
            content: "Data không tồn tại!",
            ephemeral: true,
          });

        await interaction.deferUpdate();

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
      }
    } catch (error) {
      await logger.error(`Button handler error: ${error.message}`, SHEETS_ID);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Lỗi xử lý button!",
          ephemeral: true,
        });
      }
    }
  } else if (interaction.isModalSubmit()) {
    // Giữ nguyên logic modal (đã fix deferUpdate ở capital modal)
    try {
      if (interaction.customId.startsWith("capital_modal_")) {
        await interaction.deferUpdate();

        const amountInput =
          interaction.fields.getTextInputValue("capital_amount");
        const addAmount = parseFloat(amountInput.replace(/[^\d]/g, "")) || 0;

        if (addAmount <= 0) {
          return interaction.followUp({
            content: "Số tiền thêm không hợp lệ!",
            ephemeral: true,
          });
        }

        const newCapital = capitalData + addAmount;
        await saveCapitalToSheet(newCapital);

        const totalConfirmed = paymentService.getTotalConfirmed();
        const newProfit = totalConfirmed - newCapital;

        const embed = new EmbedBuilder()
          .setTitle("💰 Báo cáo tài chính (sau khi thêm vốn)")
          .addFields(
            {
              name: "Tiền vốn mới",
              value: `${newCapital.toLocaleString()} VNĐ`,
              inline: true,
            },
            {
              name: "Tổng tiền confirmed",
              value: `${totalConfirmed.toLocaleString()} VNĐ`,
              inline: true,
            },
            {
              name: "Lợi nhuận",
              value: `${newProfit.toLocaleString()} VNĐ`,
              inline: true,
            }
          )
          .setColor(newProfit >= 0 ? "Green" : "Red")
          .setTimestamp();

        await logger.info(
          `[capital] Admin ${
            interaction.user.tag
          } thêm vốn ${addAmount.toLocaleString()} VNĐ → vốn mới: ${newCapital.toLocaleString()} VNĐ`,
          SHEETS_ID
        );

        await interaction.followUp({ embeds: [embed], ephemeral: false });
        return;
      }

      // Modal QR edit
      const { action: modalType, userId } = parseCustomId(interaction.customId);
      const value = interaction.fields.getTextInputValue("input_value");
      const qrObj = qrDataService.getQr(userId);

      if (!qrObj) {
        return interaction.reply({
          content: "Data không tồn tại!",
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

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
            qrObj.url = value;
            updated = true;
          } catch {
            return interaction.followUp({
              content: "URL không hợp lệ!",
              ephemeral: true,
            });
          }
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

        await interaction.editReply({
          embeds: [embed],
          files: [attachment],
          components,
        });
      }
    } catch (error) {
      await logger.error(`Modal submit error: ${error.message}`, SHEETS_ID);
      try {
        await interaction.followUp({
          content: "Lỗi xử lý modal!",
          ephemeral: true,
        });
      } catch {}
    }
  }
});

// Login
client.login(TOKEN);

// Keep-alive
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("Bot Discord đang chạy khỏe mạnh!"));
app.listen(port, () => console.log(`HTTP server on port ${port}`));
