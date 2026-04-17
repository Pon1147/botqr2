const fs = require("fs");
const path = require("path");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const { isAdmin } = require("../handlers/interactionDispatcher");

const SESSION_TTL = 10 * 60 * 1000;
const capitalSessions = new Map();

function parseCapitalCustomId(customId) {
  const match = /^capital_(dashboard|daily|report|add|back)_(.+)$/.exec(
    String(customId || ""),
  );
  if (!match) return null;
  return { action: match[1], sessionId: match[2] };
}

function isCapitalButton(customId) {
  return Boolean(parseCapitalCustomId(customId));
}

function isCapitalModal(customId) {
  return String(customId || "").startsWith("capital_modal_");
}

function createSession(sessionId, userId) {
  const timer = setTimeout(() => {
    const session = capitalSessions.get(sessionId);
    if (session?.timer) clearTimeout(session.timer);
    capitalSessions.delete(sessionId);
  }, SESSION_TTL);
  timer.unref?.();

  const session = {
    sessionId,
    userId,
    timer,
    mode: "dashboard",
  };

  capitalSessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return capitalSessions.get(sessionId) || null;
}

function ensureAllowed(interaction, config) {
  return isAdmin(interaction, config.ADMIN_ROLES || []);
}

function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
  });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("vi-VN");
}

function buildBackButton(sessionId) {
  return new ButtonBuilder()
    .setCustomId(`capital_back_${sessionId}`)
    .setLabel("Quay lại dashboard")
    .setStyle(ButtonStyle.Secondary);
}

function buildCapitalButtons(sessionId) {
  return [
    new ButtonBuilder()
      .setCustomId(`capital_daily_${sessionId}`)
      .setLabel("Doanh thu hôm nay")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`capital_report_${sessionId}`)
      .setLabel("Báo cáo vốn")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`capital_add_${sessionId}`)
      .setLabel("Thêm vốn")
      .setStyle(ButtonStyle.Success),
  ];
}

function buildDashboardEmbed({ capital, totalConfirmed, todayRevenue, todayCount }) {
  const profit = totalConfirmed - capital;

  return new EmbedBuilder()
    .setColor(profit >= 0 ? "Green" : "Red")
    .setTitle("📊 Dashboard tài chính")
    .setDescription("Chọn nút bên dưới để xem doanh thu, báo cáo vốn hoặc thêm vốn.")
    .addFields(
      { name: "Tiền vốn hiện tại", value: formatCurrency(capital), inline: true },
      { name: "Tổng confirmed", value: formatCurrency(totalConfirmed), inline: true },
      { name: "Lợi nhuận", value: formatCurrency(profit), inline: true },
      { name: "Doanh thu hôm nay", value: formatCurrency(todayRevenue), inline: true },
      { name: "Số giao dịch hôm nay", value: String(todayCount), inline: true },
    )
    .setTimestamp();
}

function buildCapitalReportEmbed({ capital, totalConfirmed }) {
  const profit = totalConfirmed - capital;

  return new EmbedBuilder()
    .setTitle("Báo cáo tài chính")
    .addFields(
      { name: "Tiền vốn hiện tại", value: formatCurrency(capital), inline: true },
      { name: "Tổng tiền confirmed", value: formatCurrency(totalConfirmed), inline: true },
      { name: "Lợi nhuận", value: formatCurrency(profit), inline: true },
    )
    .setColor(profit >= 0 ? "Green" : "Red")
    .setTimestamp();
}

function buildDailyReportEmbed(todayTxs, totalRevenue, sellerTag) {
  const items = todayTxs
    .slice(0, 20)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(
      (tx) =>
        `✅ ${tx.id} - ${formatCurrency(tx.amount)} (<@${tx.buyerId}> → ${sellerTag}) - ${formatDateTime(tx.date)}`,
    )
    .join("\n");

  return new EmbedBuilder()
    .setColor(0xffc0cb)
    .setTitle(`💰 Doanh thu hôm nay (${formatDate(new Date())})`)
    .addFields(
      { name: "Tổng doanh thu", value: formatCurrency(totalRevenue), inline: true },
      { name: "Số giao dịch", value: String(todayTxs.length), inline: true },
      { name: "Danh sách TX", value: items || "Chưa có TX" },
    )
    .setTimestamp()
    .setFooter({ text: "Cảm ơn các bạn đã ủng hộ hôm nay!" });
}

function buildFinanceViewState(paymentService, capital) {
  const sortedPayments = paymentService.getSortedPayments();
  const confirmedTxs = sortedPayments.filter((tx) => tx.status === "confirmed");
  const todayISO = new Date().toISOString().split("T")[0];
  const todayTxs = confirmedTxs.filter((tx) => {
    const txDate = new Date(tx.date).toISOString().split("T")[0];
    return txDate === todayISO;
  });

  return {
    capital,
    totalConfirmed: paymentService.getTotalConfirmed(),
    todayRevenue: todayTxs.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0),
    todayCount: todayTxs.length,
    todayTxs,
  };
}

async function resolveSellerTag(interaction, logger, sheetsId) {
  let sellerTag = "Unknown Seller";
  const sellerId = process.env.DEFAULT_SELLER_ID;
  if (!sellerId) return sellerTag;

  try {
    const seller = await interaction.client.users.fetch(sellerId);
    sellerTag = seller.tag || seller.username || sellerId;
  } catch (error) {
    await logger.warn(
      `Không thể lấy seller tag cho daily report: ${error.message}`,
      sheetsId,
    );
  }

  return sellerTag;
}

async function syncFinanceData(config) {
  const {
    paymentService,
    getCapitalData,
    loadCapitalFromSheet,
    SHEETS_ID,
  } = config;

  await Promise.all([
    loadCapitalFromSheet(config),
    paymentService.loadPaymentsFromSheet(SHEETS_ID),
  ]);

  return getCapitalData();
}

function resolveBannerAttachment() {
  const bannerPath = path.join(__dirname, "../assets/banner.png");
  if (!fs.existsSync(bannerPath)) return null;
  return new AttachmentBuilder(bannerPath, { name: "banner.png" });
}

async function editSourceMessage(interaction, payload) {
  if (!interaction.message || typeof interaction.message.edit !== "function") {
    throw new Error("Thiếu message nguồn để cập nhật finance dashboard");
  }

  return interaction.message.edit(payload);
}

async function renderDashboard(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên tài chính đã hết hạn, hãy chạy /capital lại nhé.",
      ephemeral: true,
    });
  }

  const capital = await syncFinanceData(config);
  const state = buildFinanceViewState(config.paymentService, capital);

  session.mode = "dashboard";

  return editSourceMessage(interaction, {
    embeds: [buildDashboardEmbed(state)],
    components: [
      new ActionRowBuilder().addComponents(...buildCapitalButtons(sessionId)),
    ],
    files: [],
  });
}

async function renderCapitalReport(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên tài chính đã hết hạn, hãy chạy /capital lại nhé.",
      ephemeral: true,
    });
  }

  const capital = await syncFinanceData(config);
  const state = buildFinanceViewState(config.paymentService, capital);

  session.mode = "capital-report";

  return editSourceMessage(interaction, {
    embeds: [buildCapitalReportEmbed(state)],
    components: [
      new ActionRowBuilder().addComponents(
        ...buildCapitalButtons(sessionId).slice(1),
        buildBackButton(sessionId),
      ),
    ],
    files: [],
  });
}

async function renderDailyReport(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên tài chính đã hết hạn, hãy chạy /capital lại nhé.",
      ephemeral: true,
    });
  }

  const capital = await syncFinanceData(config);
  const state = buildFinanceViewState(config.paymentService, capital);
  const sellerTag = await resolveSellerTag(interaction, config.logger, config.SHEETS_ID);
  const bannerAttachment = resolveBannerAttachment();

  session.mode = "daily-report";

  const embed = buildDailyReportEmbed(state.todayTxs, state.todayRevenue, sellerTag);
  const payload = {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buildBackButton(sessionId))],
  };

  if (bannerAttachment) {
    payload.files = [bannerAttachment];
    embed.setImage("attachment://banner.png");
  }

  return editSourceMessage(interaction, payload);
}

async function renderDashboardReply(interaction, config, sessionId) {
  const capital = await syncFinanceData(config);
  const state = buildFinanceViewState(config.paymentService, capital);

  const replyMessage = await interaction.editReply({
    embeds: [buildDashboardEmbed(state)],
    components: [
      new ActionRowBuilder().addComponents(...buildCapitalButtons(sessionId)),
    ],
    fetchReply: true,
    ephemeral: false,
  });

  const session = getSession(sessionId);
  if (session) {
    session.messageId = replyMessage.id;
  }
}

async function handleCapitalCommand(interaction, config) {
  if (!ensureAllowed(interaction, config)) {
    return interaction.reply({
      content: "Bạn không có quyền admin!",
      ephemeral: true,
    });
  }

  const sessionId = interaction.id;
  createSession(sessionId, interaction.user.id);

  await renderDashboardReply(interaction, config, sessionId);

  await config.logger.info(
    `[capital] Admin ${interaction.user.tag} mở dashboard tài chính`,
    config.SHEETS_ID,
  );
}

async function handleCapitalButton(interaction, config) {
  const parsed = parseCapitalCustomId(interaction.customId);
  if (!parsed) return;

  const session = getSession(parsed.sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên tài chính đã hết hạn, hãy chạy /capital lại nhé.",
      ephemeral: true,
    });
  }

  if (!ensureAllowed(interaction, config)) {
    return interaction.reply({
      content: "Bạn không có quyền admin!",
      ephemeral: true,
    });
  }

  if (interaction.user.id !== session.userId) {
    return interaction.reply({
      content: "Bạn không thể dùng dashboard của người khác!",
      ephemeral: true,
    });
  }

  if (parsed.action === "add") {
    const modal = new ModalBuilder()
      .setCustomId(`capital_modal_${parsed.sessionId}`)
      .setTitle("Thêm tiền vốn");

    const input = new TextInputBuilder()
      .setCustomId("capital_amount")
      .setLabel("Số tiền thêm (VND)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Ví dụ: 500000")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  await interaction.deferUpdate();

  if (parsed.action === "back") {
    return renderDashboard(interaction, config, parsed.sessionId);
  }

  if (parsed.action === "report") {
    return renderCapitalReport(interaction, config, parsed.sessionId);
  }

  if (parsed.action === "daily") {
    return renderDailyReport(interaction, config, parsed.sessionId);
  }
}

async function handleCapitalModal(interaction, config) {
  const sessionId = String(interaction.customId || "").replace("capital_modal_", "");
  const session = getSession(sessionId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!session) {
    return interaction.editReply({
      content: "Phiên tài chính đã hết hạn, hãy chạy /capital lại nhé.",
    });
  }

  if (!ensureAllowed(interaction, config)) {
    return interaction.editReply({
      content: "Bạn không có quyền admin!",
    });
  }

  if (interaction.user.id !== session.userId) {
    return interaction.editReply({
      content: "Bạn không thể dùng dashboard của người khác!",
    });
  }

  const {
    paymentService,
    logger,
    getCapitalData,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    SHEETS_ID,
  } = config;

  const amountInput = interaction.fields.getTextInputValue("capital_amount");
  const addAmount = Number.parseFloat(amountInput.replace(/[^\d]/g, "")) || 0;

  if (addAmount <= 0) {
    return interaction.editReply({
      content: "Số tiền thêm không hợp lệ!",
    });
  }

  try {
    await Promise.all([
      loadCapitalFromSheet(config),
      paymentService.loadPaymentsFromSheet(SHEETS_ID),
    ]);
  } catch (syncError) {
    return interaction.editReply({
      content: `Không thể đồng bộ dữ liệu mới nhất: ${syncError.message}`,
    });
  }

  const currentCapital = getCapitalData();
  const newCapital = currentCapital + addAmount;

  let savedCapital;
  try {
    savedCapital = await saveCapitalToSheet(newCapital, config);
  } catch (saveError) {
    return interaction.editReply({
      content: `Không thể lưu vốn: ${saveError.message}`,
    });
  }

  const totalConfirmed = paymentService.getTotalConfirmed();
  const profit = totalConfirmed - savedCapital;

  const embed = new EmbedBuilder()
    .setTitle("Báo cáo tài chính (sau thêm vốn)")
    .addFields(
      {
        name: "Vốn mới",
        value: formatCurrency(savedCapital),
        inline: true,
      },
      {
        name: "Tổng confirmed",
        value: formatCurrency(totalConfirmed),
        inline: true,
      },
      {
        name: "Lợi nhuận",
        value: formatCurrency(profit),
        inline: true,
      },
    )
    .setColor(profit >= 0 ? "Green" : "Red")
    .setTimestamp();

  await logger.info(
    `[capital] ${interaction.user.tag} thêm ${formatCurrency(addAmount)} -> vốn mới: ${formatCurrency(savedCapital)}`,
    SHEETS_ID,
  );

  await interaction.followUp({ embeds: [embed], ephemeral: false });
}

module.exports = {
  handleCapitalCommand,
  handleCapitalButton,
  handleCapitalModal,
  isCapitalButton,
  isCapitalModal,
};
