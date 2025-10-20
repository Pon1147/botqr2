require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
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

// Load token
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error("Lỗi: Không tìm thấy TOKEN trong .env!");
  process.exit(1);
}

const GUILD_ID = process.env.GUILD_ID;
const DATA_FILE = path.join(__dirname, "data.json");
const LOGS_DIR = path.join(__dirname, "logs");

// Hàm tạo/get file log theo ngày
async function getLogFile() {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const logFile = path.join(LOGS_DIR, `${dateStr}.log`);

  // Tạo thư mục logs nếu chưa có
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    console.error("Lỗi tạo thư mục logs:", error);
  }

  return logFile;
}

// Hàm log với timestamp
async function logMessage(message) {
  const now = new Date();
  const timestamp = now.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  }); // VN time
  const logEntry = `[${timestamp}] ${message}\n`;

  try {
    const logFile = await getLogFile();
    await fs.appendFile(logFile, logEntry);
    console.log(logEntry.trim()); // Cũng log ra console
  } catch (error) {
    console.error("Lỗi ghi log:", error);
  }
}

let userQrData = new Map(); // userId -> {bank: str, account: str, url: str, logo: str?}

async function loadData() {
  try {
    const data = await fs.readFile(DATA_FILE, "utf8");
    const parsedData = JSON.parse(data);
    userQrData.clear();
    for (const [userId, qrObj] of Object.entries(parsedData)) {
      userQrData.set(userId, qrObj);
    }
    await logMessage(`Load data: ${userQrData.size} users`);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(DATA_FILE, "{}");
      await logMessage("Tạo file data.json mới");
    } else {
      await logMessage(`Lỗi load data: ${error.message}`);
    }
  }
}

async function saveData() {
  try {
    const dataToSave = Object.fromEntries(userQrData);
    await fs.writeFile(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    // Không log mỗi save để tránh spam
  } catch (error) {
    await logMessage(`Lỗi save data: ${error.message}`);
  }
}

// Tạo embed giống mockup (fields không inline, thêm "Mã QR" placeholder)
function createQrEmbed(qrObj, attachment) {
  const { bank, account, url, logo } = qrObj;
  return new EmbedBuilder()
    .setColor(0xe0f7fa) // Màu xanh nhạt
    .addFields(
      { name: "Tên Chủ Tài Khoản", value: bank || "Chưa set", inline: false }, // Dọc: name > value
      { name: "Số Tài Khoản", value: account || "Chưa set", inline: false }, // Dọc
      { name: "Mã QR", value: "\u200B", inline: false } // Placeholder cho QR dưới
    )
    .setImage("attachment://my_qr.png") // QR dưới fields
    .setTimestamp()
    .setFooter({ text: "QR Payment Bot" })
    .setThumbnail(logo || null); // Logo nếu có
}

// Tạo buttons edit
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

// Tạo modal
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

// Parse customId
function parseCustomId(customId) {
  const parts = customId.split("_");
  const userId = parts.pop();
  const action = parts.join("_");
  return { action, userId };
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
  await logMessage(`Bot online: ${client.user.tag}`);
  await loadData();

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    await logMessage(`Lỗi: Không tìm thấy guild ID ${GUILD_ID}!`);
    return;
  }

  const commands = [
    new SlashCommandBuilder()
      .setName("setqr")
      .setDescription("Thiết lập QR code với buttons edit")
      .addStringOption((option) =>
        option
          .setName("bank_name")
          .setDescription("Tên chủ TK/ngân hàng")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("account_number")
          .setDescription("Số tài khoản")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("url")
          .setDescription("URL/text cho QR")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("logo_url")
          .setDescription("URL logo thumbnail (optional)")
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("qr")
      .setDescription("Hiển thị QR embed với buttons edit"),
    new SlashCommandBuilder()
      .setName("resetqr")
      .setDescription("Reset QR data của bạn"),
  ].map((command) => command.toJSON());

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
    const { commandName } = interaction;
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;

    if (commandName === "setqr") {
      const bank = interaction.options.getString("bank_name");
      const account = interaction.options.getString("account_number");
      const url = interaction.options.getString("url");
      const logo = interaction.options.getString("logo_url") || null;

      await logMessage(
        `[setqr] User ${userTag} (${userId}) input: bank=${bank}, account=${account}, url=${url}, logo=${
          logo || "none"
        }`
      );

      try {
        const qrBuffer = await QRCode.toBuffer(url, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        }); // Test QR trước
        const attachment = new AttachmentBuilder(qrBuffer, {
          name: "my_qr.png",
        });

        userQrData.set(userId, { bank, account, url, logo }); // Set sau QR OK
        await saveData(); // Save chỉ nếu QR OK

        const embed = createQrEmbed(userQrData.get(userId), attachment);
        const components = [createEditButtons(userId)];

        await interaction.reply({
          embeds: [embed],
          files: [attachment],
          components,
          ephemeral: true,
        });
        await logMessage(`[setqr] Thành công cho ${userTag}`);
      } catch (error) {
        await logMessage(
          `[setqr] Lỗi QR cho ${userTag}: ${error.message} (không save data)`
        );
        await interaction.reply({
          content: `Lỗi tạo QR từ "${url}"! Kiểm tra URL hợp lệ.`,
          ephemeral: true,
        });
      }
    } else if (commandName === "qr") {
      const qrObj = userQrData.get(userId);
      if (!qrObj) {
        await logMessage(`[qr] User ${userTag} (${userId}) chưa set QR`);
        return interaction.reply({
          content: "Chưa set QR! Dùng /setqr trước.",
          ephemeral: true,
        }); // Giữ ephemeral cho lỗi
      }
      await logMessage(`[qr] User ${userTag} (${userId}) xem QR`);

      try {
        const qrBuffer = await QRCode.toBuffer(qrObj.url, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });
        const attachment = new AttachmentBuilder(qrBuffer, {
          name: "my_qr.png",
        });
        const embed = createQrEmbed(qrObj, attachment);
        const components = [createEditButtons(userId)]; // Buttons vẫn chỉ bạn click được (check UID)

        await interaction.reply({
          embeds: [embed],
          files: [attachment],
          components,
          ephemeral: false,
        }); // Public!
        await logMessage(`[qr] Thành công (public) cho ${userTag}`);
      } catch (error) {
        await logMessage(`[qr] Lỗi tạo QR cho ${userTag}: ${error.message}`);
        await interaction.reply({
          content: `Lỗi tạo QR từ "${qrObj.url}"!`,
          ephemeral: true,
        });
      }
    } else if (commandName === "resetqr") {
      if (!userQrData.has(userId)) {
        await logMessage(`[resetqr] User ${userTag} (${userId}) chưa có data`);
        return interaction.reply({
          content: "Chưa có data để reset!",
          ephemeral: true,
        });
      }
      userQrData.delete(userId);
      await saveData();
      await logMessage(`[resetqr] User ${userTag} (${userId}) reset data`);
      await interaction.reply({
        content: "Đã reset QR data của bạn!",
        ephemeral: true,
      });
    }
  } else if (interaction.isButton()) {
    const { action, userId } = parseCustomId(interaction.customId);
    const userTag = interaction.user.tag;
    if (interaction.user.id !== userId) {
      await logMessage(
        `[button] User ${userTag} (${interaction.user.id}) cố click button của ${userId} - bị chặn`
      );
      return interaction.reply({
        content: "Không phải của bạn!",
        ephemeral: true,
      });
    }

    const qrObj = userQrData.get(userId);
    if (!qrObj) {
      await logMessage(
        `[button] User ${userTag} (${userId}) click ${action} nhưng data không tồn tại`
      );
      return interaction.reply({
        content: "Data không tồn tại!",
        ephemeral: true,
      });
    }

    await logMessage(`[button] User ${userTag} (${userId}) click ${action}`);

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
        await saveData();
        await logMessage(
          `[button] User ${userTag} (${userId}) reset qua button`
        );
        await interaction.update({ content: "Đã reset!", components: [] });
        break;
    }
  } else if (interaction.isModalSubmit()) {
    const { action: modalType, userId } = parseCustomId(interaction.customId);
    const value = interaction.fields.getTextInputValue("input_value");
    const userTag = interaction.user.tag;
    const qrObj = userQrData.get(userId);
    if (!qrObj) {
      await logMessage(
        `[modal] User ${userTag} (${userId}) submit ${modalType} nhưng data không tồn tại`
      );
      return interaction.reply({
        content: "Data không tồn tại!",
        ephemeral: true,
      });
    }

    let updated = false;
    let fieldName = "";
    switch (modalType) {
      case "modal_bank":
        qrObj.bank = value;
        updated = true;
        fieldName = "Tên Chủ TK";
        break;
      case "modal_account":
        qrObj.account = value;
        updated = true;
        fieldName = "Số Tài Khoản";
        break;
      case "modal_url":
        qrObj.url = value;
        updated = true;
        fieldName = "URL/QR";
        break;
    }

    if (updated) {
      userQrData.set(userId, qrObj);
      await saveData();
      await logMessage(
        `[modal] User ${userTag} (${userId}) update ${fieldName}: ${value}`
      );

      try {
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
      } catch (error) {
        await logMessage(`Lỗi update QR cho ${userTag}: ${error.message}`);
        await interaction.reply({ content: "Lỗi update QR!", ephemeral: true });
      }
    } else {
      await logMessage(
        `[modal] User ${userTag} (${userId}) submit ${modalType} lỗi`
      );
      await interaction.reply({ content: "Lỗi update!", ephemeral: true });
    }
  }
});

client.login(TOKEN);
