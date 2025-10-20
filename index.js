// index.js - Main Bot File
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
const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Load token
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Lỗi: Không tìm thấy TOKEN trong .env!");
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLES = process.env.ADMIN_ROLES
  ? process.env.ADMIN_ROLES.split(",")
  : ["Admin"]; // Flexible roles from env
const DATA_FILE = path.join(__dirname, "data.json");
const PAYMENTS_FILE = path.join(__dirname, "payments.json");
const LOGS_DIR = path.join(__dirname, "logs");

// Load commands from folder
const fsSync = require("fs");
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fsSync
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
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    console.error("Lỗi tạo thư mục logs:", error);
  }
  return logFile;
}

async function logMessage(message) {
  const now = new Date();
  const timestamp = now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const logEntry = `[${timestamp}] ${message}\n`;
  try {
    const logFile = await getLogFile();
    await fs.appendFile(logFile, logEntry);
    console.log(logEntry.trim());
  } catch (error) {
    console.error("Lỗi ghi log:", error);
  }
}

// Data functions
let userQrData = new Map();

async function loadData() {
  try {
    const data = await fs.readFile(DATA_FILE, "utf8");
    const parsedData = JSON.parse(data);
    userQrData.clear();
    for (const [userId, qrObj] of Object.entries(parsedData)) {
      userQrData.set(userId, qrObj);
    }
    await logMessage(`Load QR data: ${userQrData.size} users`);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(DATA_FILE, "{}");
      await logMessage("Tạo file data.json mới");
    } else {
      await logMessage(`Lỗi load QR data: ${error.message}`);
    }
  }
}

async function saveQrData() {
  try {
    const dataToSave = Object.fromEntries(userQrData);
    await fs.writeFile(DATA_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    await logMessage(`Lỗi save QR data: ${error.message}`);
  }
}

let paymentsData = [];

async function loadPaymentsData() {
  try {
    const data = await fs.readFile(PAYMENTS_FILE, "utf8");
    paymentsData = JSON.parse(data).transactions || [];
    paymentsData.sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort desc by date
    await logMessage(`Load payments data: ${paymentsData.length} transactions`);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(
        PAYMENTS_FILE,
        JSON.stringify({ transactions: [] }, null, 2)
      );
      await logMessage("Tạo file payments.json mới");
    } else {
      await logMessage(`Lỗi load payments data: ${error.message}`);
    }
  }
}

async function savePaymentsData() {
  try {
    const dataToSave = [...paymentsData].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    ); // Ensure sorted on save
    await fs.writeFile(
      PAYMENTS_FILE,
      JSON.stringify({ transactions: dataToSave }, null, 2)
    );
  } catch (error) {
    await logMessage(`Lỗi save payments data: ${error.message}`);
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
  const parts = customId.split("_");
  if (parts.length < 2) {
    throw new Error("Invalid customId format");
  }
  const userId = parts.pop();
  const action = parts.join("_");
  return { action, userId };
}

client.once("clientReady", async () => {
  await logMessage(`Bot online: ${client.user.tag}`);
  await loadData();
  await loadPaymentsData();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    await logMessage(`Lỗi: Không tìm thấy guild ID ${GUILD_ID}!`);
    return;
  }

  const commands = [];
  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    commands.push(command.data.toJSON());
  }

  try {
    await guild.commands.set(commands);
    await logMessage(
      `Sync ${commands.length} commands cho guild ${guild.name}`
    );
  } catch (error) {
    await logMessage(`Lỗi sync: ${error.message}`);
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
        saveQrData,
        savePaymentsData,
        logMessage,
        QRCode,
        AttachmentBuilder,
        createQrEmbed,
        createEditButtons
      );
    } catch (error) {
      await logMessage(
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
      // Handle edit buttons
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
            await saveQrData();
            await interaction.update({ content: "Đã reset!", components: [] });
            break;
        }
      } else if (action === "prev" || action === "next") {
        // Handle pagination buttons from payment-info (logic in command, but placeholder for global if needed)
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
        await saveQrData();

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
        await logMessage(`Lỗi modal: ${error.message}`);
        await interaction.reply({ content: "Có lỗi xảy ra!", ephemeral: true });
      }
    }
  }
});

client.login(TOKEN);
