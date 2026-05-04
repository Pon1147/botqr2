const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} = require("discord.js");

const { createPaginationRow } = require("../utils/paginationUtils");
const { isAdmin } = require("../handlers/interactionDispatcher");

const SESSION_TTL = 10 * 60 * 1000;
const sessions = new Map();

function parseInfoCustomId(customId) {
  const match = /^info_(action|tx|buyer|status|back|prev|next)_(.+)$/.exec(
    String(customId || ""),
  );
  if (!match) return null;
  return { action: match[1], sessionId: match[2] };
}

function isInfoButton(customId) {
  const parsed = parseInfoCustomId(customId);
  return Boolean(parsed && ["back", "prev", "next"].includes(parsed.action));
}

function isInfoSelectMenu(customId) {
  const parsed = parseInfoCustomId(customId);
  return Boolean(parsed && ["action", "tx", "buyer", "status"].includes(parsed.action));
}

function createSession(sessionId, userId) {
  const timer = setTimeout(() => {
    const session = sessions.get(sessionId);
    if (session?.timer) clearTimeout(session.timer);
    sessions.delete(sessionId);
  }, SESSION_TTL);
  timer.unref?.();

  const session = {
    sessionId,
    userId,
    mode: "dashboard",
    listFilter: "all",
    listPage: 0,
    timer,
  };

  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("vi-VN");
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("vi-VN");
}

function truncate(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function buildStatusLabel(status) {
  switch (status) {
    case "confirmed":
      return "✅ Hoàn thành";
    case "cancelled":
      return "❌ Hủy";
    default:
      return "⏳ Chờ";
  }
}

function buildStatusIcon(status) {
  switch (status) {
    case "confirmed":
      return "✅";
    case "cancelled":
      return "❌";
    default:
      return "⏳";
  }
}

function getFilteredPayments(paymentService, statusFilter) {
  const payments = paymentService.getSortedPayments();
  if (!statusFilter || statusFilter === "all") {
    return payments;
  }

  return payments.filter((tx) => tx.status === statusFilter);
}

async function resolveSellerTag(interaction, logger, sheetsId) {
  let sellerTag = "Seller Fixed";
  const sellerId = process.env.DEFAULT_SELLER_ID;
  if (!sellerId) return sellerTag;

  try {
    const seller = await interaction.client.users.fetch(sellerId);
    sellerTag = seller.tag;
  } catch (error) {
    await logger.error(
      `Lỗi lấy seller info khi mở dashboard: ${error.message}`,
      sheetsId,
    );
  }

  return sellerTag;
}

function ensureAllowed(interaction, config) {
  if (!isAdmin(interaction, config.ADMIN_ROLES || [])) {
    return false;
  }
  return true;
}

function buildDashboardEmbed(paymentService) {
  const payments = paymentService.getSortedPayments();
  const confirmedCount = payments.filter((tx) => tx.status === "confirmed").length;
  const pendingCount = payments.filter((tx) => tx.status === "pending").length;
  const cancelledCount = payments.filter((tx) => tx.status === "cancelled").length;

  return new EmbedBuilder()
    .setColor("Blue")
    .setTitle("📊 Dashboard giao dịch")
    .setDescription(
      "Chọn thao tác bên dưới để xem dữ liệu mà không cần nhập mã TX hay tên buyer.",
    )
    .addFields(
      { name: "Tổng giao dịch", value: String(payments.length), inline: true },
      { name: "Đã xác nhận", value: String(confirmedCount), inline: true },
      { name: "Đang chờ", value: String(pendingCount), inline: true },
      { name: "Đã hủy", value: String(cancelledCount), inline: true },
      {
        name: "Tổng confirmed",
        value: formatCurrency(paymentService.getTotalConfirmed()),
        inline: true,
      },
    )
    .setTimestamp();
}

function buildActionRow(sessionId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`info_action_${sessionId}`)
    .setPlaceholder("Chọn thao tác")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Chi tiết giao dịch")
        .setValue("tx")
        .setDescription("Chọn một TX từ danh sách gần nhất"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Tổng buyer")
        .setValue("buyer")
        .setDescription("Chọn buyer từ server"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Danh sách giao dịch")
        .setValue("list")
        .setDescription("Lọc giao dịch theo trạng thái"),
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildBackRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`info_back_${sessionId}`)
      .setLabel("Quay lại dashboard")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildTxSelectRow(sessionId, payments) {
  const options = payments.slice(0, 25).map((tx) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncate(tx.id, 100))
      .setValue(tx.id)
      .setDescription(
        truncate(
          `${buildStatusLabel(tx.status)} • ${formatCurrency(tx.amount)} • Buyer ${truncate(
            tx.buyerId,
            16,
          )}`,
          100,
        ),
      ),
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`info_tx_${sessionId}`)
      .setPlaceholder("Chọn giao dịch cần xem")
      .addOptions(options),
  );
}

function buildBuyerSelectRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`info_buyer_${sessionId}`)
      .setPlaceholder("Chọn buyer trong server"),
  );
}

function buildStatusSelectRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`info_status_${sessionId}`)
      .setPlaceholder("Lọc theo trạng thái")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Tất cả")
          .setValue("all")
          .setDescription("Hiển thị toàn bộ giao dịch"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Pending")
          .setValue("pending")
          .setDescription("Chỉ hiển thị giao dịch đang chờ"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Confirmed")
          .setValue("confirmed")
          .setDescription("Chỉ hiển thị giao dịch đã xác nhận"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Cancelled")
          .setValue("cancelled")
          .setDescription("Chỉ hiển thị giao dịch đã hủy"),
      ),
  );
}

function buildTxDetailEmbed(tx, sellerTag) {
  return new EmbedBuilder()
    .setTitle(`📋 Chi tiết TX ${tx.id}`)
    .addFields(
      { name: "Trạng thái", value: buildStatusLabel(tx.status), inline: true },
      { name: "Số tiền", value: formatCurrency(tx.amount), inline: true },
      { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true },
      { name: "Seller", value: sellerTag || "Seller Fixed", inline: true },
      { name: "Mô tả", value: tx.description || "N/A" },
      { name: "Ngày tạo", value: formatDateTime(tx.date), inline: true },
      {
        name: "Ngày xử lý",
        value: tx.processedDate ? formatDateTime(tx.processedDate) : "N/A",
        inline: true,
      },
      ...(tx.reason ? [{ name: "Lý do", value: tx.reason }] : []),
    )
    .setColor(
      tx.status === "confirmed"
        ? "Green"
        : tx.status === "cancelled"
        ? "Red"
        : "Blue",
    )
    .setTimestamp();
}

function buildBuyerSummaryEmbed(targetUser, buyerTxs, totalAmount, avgAmount) {
  const recentTxs = buyerTxs.slice(0, 5);
  const list = recentTxs.length
    ? recentTxs
        .map(
          (tx) =>
            `${buildStatusIcon(tx.status)} ${tx.id} - ${formatCurrency(tx.amount)} - ${formatDate(
              tx.date,
            )}`,
        )
        .join("\n")
    : "Chưa có giao dịch confirmed.";

  return new EmbedBuilder()
    .setTitle(`👤 ${targetUser.username} (Buyer - Tiền đã trả)`)
    .addFields(
      { name: "💰 Tổng", value: formatCurrency(totalAmount), inline: true },
      {
        name: "📊 Số giao dịch hoàn thành",
        value: String(buyerTxs.length),
        inline: true,
      },
      {
        name: "📈 Trung bình/giao dịch",
        value: buyerTxs.length > 0 ? formatCurrency(avgAmount) : formatCurrency(0),
        inline: true,
      },
      { name: "📋 Giao dịch gần nhất", value: list },
    )
    .setColor("Blue")
    .setTimestamp();
}

function buildListEmbed({
  filteredTxs,
  totalConfirmed,
  sellerTag,
  statusFilter,
  page,
  totalPages,
}) {
  const start = page * 10;
  const pageTxs = filteredTxs.slice(start, start + 10);
  const list = pageTxs
    .map(
      (tx) =>
        `${buildStatusIcon(tx.status)} ${tx.id} - ${formatCurrency(tx.amount)} (<@${tx.buyerId}> -> ${sellerTag}) - ${formatDate(
          tx.date,
        )}`,
    )
    .join("\n");

  const truncatedList = list ? truncate(list, 1024) : "N/A";

  return new EmbedBuilder()
    .setTitle(
      `📋 Danh sách giao dịch ${statusFilter !== "all" ? `(${statusFilter})` : ""} - Trang ${
        page + 1
      }/${Math.max(totalPages, 1)}`,
    )
    .addFields(
      {
        name: "Tổng số giao dịch",
        value: String(filteredTxs.length),
        inline: true,
      },
      {
        name: "Tổng số tiền (Confirmed)",
        value: formatCurrency(totalConfirmed),
        inline: true,
      },
      {
        name: `Trang ${page + 1}/${Math.max(totalPages, 1)}`,
        value: truncatedList,
      },
    )
    .setColor("Blue")
    .setTimestamp();
}

function buildListRows(sessionId, page, totalPages) {
  const rows = [];
  if (totalPages > 1) {
    rows.push(
      createPaginationRow({
        prevCustomId: `info_prev_${sessionId}`,
        nextCustomId: `info_next_${sessionId}`,
        page,
        totalPages,
        prevLabel: "Trước",
        nextLabel: "Sau",
        buttonStyle: ButtonStyle.Primary,
      }),
    );
  }

  rows.push(buildBackRow(sessionId));
  return rows;
}

async function editMessage(interaction, payload) {
  if (!interaction.message || typeof interaction.message.edit !== "function") {
    throw new Error("Thiếu message nguồn để cập nhật dashboard");
  }

  return interaction.message.edit(payload);
}

async function renderDashboard(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  session.mode = "dashboard";
  session.listFilter = "all";
  session.listPage = 0;

  return editMessage(interaction, {
    embeds: [buildDashboardEmbed(config.paymentService)],
    components: [buildActionRow(sessionId)],
  });
}

async function renderTxSelection(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  const payments = config.paymentService.getSortedPayments();
  session.mode = "tx-select";

  if (payments.length === 0) {
    return editMessage(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Chọn giao dịch")
          .setDescription("Chưa có giao dịch nào để chọn.")
          .setColor(0xffb5da)
          .setTimestamp(),
      ],
      components: [buildBackRow(sessionId)],
    });
  }

  return editMessage(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle("📋 Chọn giao dịch cần xem")
        .setDescription("Danh sách bên dưới là 25 giao dịch mới nhất.")
        .setColor("Blue")
        .setTimestamp(),
    ],
    components: [buildTxSelectRow(sessionId, payments), buildBackRow(sessionId)],
  });
}

async function renderBuyerSelection(interaction, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  session.mode = "buyer-select";
  return editMessage(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle("👤 Chọn buyer")
        .setDescription("Dùng user select menu bên dưới để chọn buyer cần xem.")
        .setColor("Blue")
        .setTimestamp(),
    ],
    components: [buildBuyerSelectRow(sessionId), buildBackRow(sessionId)],
  });
}

async function renderStatusSelection(interaction, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  session.mode = "status-select";
  return editMessage(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle("📋 Lọc danh sách giao dịch")
        .setDescription("Chọn trạng thái để xem danh sách giao dịch tương ứng.")
        .setColor("Blue")
        .setTimestamp(),
    ],
    components: [buildStatusSelectRow(sessionId), buildBackRow(sessionId)],
  });
}

async function renderTxDetail(interaction, config, sessionId, txId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  const tx = config.paymentService.getPaymentById(txId);
  if (!tx) {
    return interaction.reply({
      content: "Giao dịch không tồn tại!",
      ephemeral: true,
    });
  }

  const sellerTag = await resolveSellerTag(
    interaction,
    config.logger,
    config.SHEETS_ID,
  );

  await config.logger.info(
    `[info] Admin ${interaction.user.tag} xem chi tiết TX ${txId}`,
    config.SHEETS_ID,
  );

  session.mode = "tx-detail";
  return editMessage(interaction, {
    embeds: [buildTxDetailEmbed(tx, sellerTag)],
    components: [buildBackRow(sessionId)],
  });
}

async function renderBuyerSummary(interaction, config, sessionId, userId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  const targetUser = await interaction.client.users.fetch(userId);
  const buyerTxs = config
    .paymentService
    .getSortedPayments()
    .filter((tx) => tx.buyerId === userId && tx.status === "confirmed");
  const totalAmount = buyerTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const avgAmount = buyerTxs.length > 0 ? totalAmount / buyerTxs.length : 0;

  await config.logger.info(
    `[info] Admin ${interaction.user.tag} xem buyer ${targetUser.tag} (${userId}): ${formatCurrency(totalAmount)}`,
    config.SHEETS_ID,
  );

  session.mode = "buyer-detail";
  return editMessage(interaction, {
    embeds: [buildBuyerSummaryEmbed(targetUser, buyerTxs, totalAmount, avgAmount)],
    components: [buildBackRow(sessionId)],
  });
}

async function renderListPage(interaction, config, sessionId, statusFilter, page) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
      ephemeral: true,
    });
  }

  const filteredTxs = getFilteredPayments(config.paymentService, statusFilter);
  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / 10));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const sellerTag = await resolveSellerTag(
    interaction,
    config.logger,
    config.SHEETS_ID,
  );

  session.mode = "list";
  session.listFilter = statusFilter || "all";
  session.listPage = currentPage;

  await config.logger.info(
    `[info] Admin ${interaction.user.tag} xem list (${session.listFilter}): ${filteredTxs.length} tx`,
    config.SHEETS_ID,
  );

  if (filteredTxs.length === 0) {
    return editMessage(interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle("📋 Danh sách giao dịch")
          .setDescription("Không có giao dịch nào khớp bộ lọc hiện tại.")
          .setColor(0xffb5da)
          .setTimestamp(),
      ],
      components: [buildBackRow(sessionId)],
    });
  }

  return editMessage(interaction, {
    embeds: [
      buildListEmbed({
        filteredTxs,
        totalConfirmed: config.paymentService.getTotalConfirmed(),
        sellerTag,
        statusFilter: session.listFilter,
        page: currentPage,
        totalPages,
      }),
    ],
    components: buildListRows(sessionId, currentPage, totalPages),
  });
}

async function handleInfoCommand(interaction, config) {
  if (!ensureAllowed(interaction, config)) {
    return interaction.reply({
      content: "Bạn không có quyền admin!",
      ephemeral: true,
    });
  }

  const sessionId = interaction.id;
  createSession(sessionId, interaction.user.id);

  const replyMessage = await interaction.editReply({
    embeds: [buildDashboardEmbed(config.paymentService)],
    components: [buildActionRow(sessionId)],
    fetchReply: true,
    ephemeral: false,
  });

  const session = getSession(sessionId);
  if (session) {
    session.messageId = replyMessage.id;
  }

  await config.logger.info(
    `[info] Admin ${interaction.user.tag} mở dashboard giao dịch`,
    config.SHEETS_ID,
  );
}

async function handleInfoSelectMenu(interaction, config) {
  const parsed = parseInfoCustomId(interaction.customId);
  if (!parsed) return;

  const session = getSession(parsed.sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
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

  await interaction.deferUpdate();

  const selectedValue = interaction.values?.[0];
  switch (parsed.action) {
    case "action":
      if (selectedValue === "tx") {
        return renderTxSelection(interaction, config, parsed.sessionId);
      }
      if (selectedValue === "buyer") {
        return renderBuyerSelection(interaction, parsed.sessionId);
      }
      if (selectedValue === "list") {
        return renderStatusSelection(interaction, parsed.sessionId);
      }
      break;
    case "tx":
      return renderTxDetail(interaction, config, parsed.sessionId, selectedValue);
    case "buyer":
      return renderBuyerSummary(interaction, config, parsed.sessionId, selectedValue);
    case "status":
      return renderListPage(interaction, config, parsed.sessionId, selectedValue, 0);
    default:
      break;
  }
}

async function handleInfoButton(interaction, config) {
  const parsed = parseInfoCustomId(interaction.customId);
  if (!parsed) return;

  const session = getSession(parsed.sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên dashboard đã hết hạn, hãy chạy /info lại nhé.",
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

  if (parsed.action === "back") {
    await interaction.deferUpdate();
    return renderDashboard(interaction, config, parsed.sessionId);
  }

  if (session.mode !== "list") {
    return interaction.reply({
      content: "Nút này chỉ dùng trong màn hình danh sách giao dịch.",
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();

  const filteredTxs = getFilteredPayments(config.paymentService, session.listFilter);
  const totalPages = Math.max(1, Math.ceil(filteredTxs.length / 10));
  const nextPage =
    parsed.action === "prev"
      ? Math.max(0, session.listPage - 1)
      : Math.min(totalPages - 1, session.listPage + 1);

  return renderListPage(
    interaction,
    config,
    parsed.sessionId,
    session.listFilter,
    nextPage,
  );
}

module.exports = {
  handleInfoCommand,
  handleInfoSelectMenu,
  handleInfoButton,
  isInfoButton,
  isInfoSelectMenu,
};
