const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

const { createQrEmbed, createEditButtons } = require("../utils/embedUtils");
const { getBankList } = require("../services/vietqrBankService");
const {
  buildVietQrImageUrl,
  fetchImageBuffer,
  generateVietQrBuffer,
} = require("../utils/vietqrUtils");

const SESSION_TTL = 10 * 60 * 1000;
const qrSessions = new Map();

function createBlankQr() {
  return {
    bank: "",
    account: "",
    url: "",
    logo: "",
    bankCode: "",
    bankName: "",
    accountName: "",
    qrContent: "",
  };
}

function cloneQr(qrObj) {
  return {
    ...createBlankQr(),
    ...(qrObj || {}),
  };
}

function hasQrData(qrObj) {
  if (!qrObj) return false;
  return Boolean(
    qrObj.bank ||
      qrObj.account ||
      qrObj.url ||
      qrObj.logo ||
      qrObj.bankCode ||
      qrObj.bankName ||
      qrObj.accountName ||
      qrObj.qrContent,
  );
}

function parseQrDashboardCustomId(customId) {
  const match = /^qr_dashboard_(edit|remove|back|save|bank|bankprev|banknext)_(.+)$/.exec(
    String(customId || ""),
  );
  if (!match) return null;
  return { action: match[1], sessionId: match[2] };
}

function isQrDashboardButton(customId) {
  return Boolean(parseQrDashboardCustomId(customId));
}

function isQrDashboardSelectMenu(customId) {
  return /^qr_dashboard_bank_(.+)$/.test(String(customId || ""));
}

function createSession(sessionId, userId, targetUserId) {
  const draft = cloneQr(null);
  const timer = setTimeout(() => {
    const session = qrSessions.get(sessionId);
    if (session?.timer) clearTimeout(session.timer);
    qrSessions.delete(sessionId);
  }, SESSION_TTL);
  timer.unref?.();

  const session = {
    sessionId,
    userId,
    targetUserId,
    mode: "dashboard",
    timer,
    draft,
  };

  qrSessions.set(sessionId, session);
  return session;
}

function getSession(sessionId) {
  return qrSessions.get(sessionId) || null;
}

async function resolveBankList(config, forceRefresh = false) {
  const service = config.vietqrBankService;
  if (service?.getBankList) {
    return service.getBankList({
      forceRefresh,
      fetchImpl: config.fetchImpl || global.fetch,
      logger: config.logger,
      sheetsId: config.SHEETS_ID,
    });
  }

  return getBankList({
    forceRefresh,
    fetchImpl: config.fetchImpl || global.fetch,
    logger: config.logger,
    sheetsId: config.SHEETS_ID,
  });
}

function buildBankPageLabel(page, totalPages) {
  return `Trang ${page + 1}/${Math.max(totalPages, 1)}`;
}

function buildBankSelectRows(sessionId, banks, page) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`qr_dashboard_bank_${sessionId}`)
    .setPlaceholder("Chọn ngân hàng")
    .addOptions(
      banks.map((bank) =>
        new StringSelectMenuOptionBuilder()
          .setLabel((bank.shortName || bank.code || bank.name || "Ngân hàng").slice(0, 100))
          .setValue(String(bank.bin))
          .setDescription(
            `${bank.bin}${bank.code ? ` • ${bank.code}` : ""}`.slice(0, 100),
          ),
      ),
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildBankNavigationRow(sessionId, page, totalPages) {
  const buttons = [];

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_bankprev_${sessionId}`)
      .setLabel("Trước")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 0),
  );

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_banknext_${sessionId}`)
      .setLabel("Sau")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1),
  );

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_edit_${sessionId}`)
      .setLabel("Quay lại chỉnh sửa")
      .setStyle(ButtonStyle.Secondary),
  );

  return new ActionRowBuilder().addComponents(buttons);
}

function findSessionByTargetUserId(targetUserId) {
  for (const session of qrSessions.values()) {
    if (session.targetUserId === targetUserId) {
      return session;
    }
  }
  return null;
}

function getDraftForTargetUser(config, targetUserId) {
  const session = findSessionByTargetUserId(targetUserId);
  if (session?.draft) {
    return cloneQr(session.draft);
  }
  return cloneQr(config.qrDataService.getQr(targetUserId));
}

function setSessionDraftField(sessionId, field, value) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.draft = {
    ...(session.draft || createBlankQr()),
    [field]: value,
  };
  return cloneQr(session.draft);
}

function resetSessionDraft(sessionId, config) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.draft = cloneQr(config.qrDataService.getQr(session.targetUserId));
  return cloneQr(session.draft);
}

async function persistSessionDraft(sessionId, config) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error("Phiên QR không tồn tại");
  }

  const draft = cloneQr(session.draft);
  if (!draft.bankCode || !draft.account) {
    throw new Error("QR phải có bank_code và account_number trước khi lưu");
  }

  config.qrDataService.setQr(session.targetUserId, draft);
  await config.qrDataService.saveQrDataToSheet(config.SHEETS_ID);
  await config.logger.info(
    `[qr] Admin ${config.logger?.name || "system"} lưu QR của ${session.targetUserId}`,
    config.SHEETS_ID,
  );

  return draft;
}

function ensureAllowed(interaction, config) {
  const adminRoles = config.ADMIN_ROLES || [];
  return (
    interaction.member?.permissions.has("Administrator") ||
    adminRoles.some((roleName) =>
      interaction.member?.roles.cache.some((role) => role.name === roleName),
    )
  );
}

function getTargetUser(interaction, config) {
  const providedUser = interaction.options?.getUser?.("user") || null;
  if (providedUser) return providedUser;

  const defaultSellerId = process.env.DEFAULT_SELLER_ID || "";
  if (defaultSellerId) {
    return interaction.client.users.fetch(defaultSellerId).catch(() => null);
  }

  return Promise.resolve(interaction.user);
}

function formatCurrency(amount) {
  return Number(amount || 0).toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
  });
}

function buildEmptyEmbed(targetUser) {
  return new EmbedBuilder()
    .setColor("Grey")
    .setTitle(`📱 QR thanh toán của ${targetUser.tag}`)
    .setDescription(
      "Chưa có QR nào được thiết lập. Chọn **Edit QR** để bắt đầu cấu hình.",
    )
    .addFields(
      { name: "Trạng thái", value: "Chưa thiết lập", inline: true },
      { name: "Tác vụ", value: "Edit QR / Remove QR", inline: true },
    )
    .setTimestamp();
}

function buildDashboardButtons(sessionId, hasQr) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_edit_${sessionId}`)
      .setLabel(hasQr ? "Edit QR" : "Thiết lập QR")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_remove_${sessionId}`)
      .setLabel("Remove QR")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasQr),
  );
}

function buildEditActionButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_save_${sessionId}`)
      .setLabel("Lưu thay đổi")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`qr_dashboard_back_${sessionId}`)
      .setLabel("Quay lại dashboard")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildEditBackButton(sessionId) {
  return new ButtonBuilder()
    .setCustomId(`qr_dashboard_back_${sessionId}`)
    .setLabel("Quay lại dashboard")
    .setStyle(ButtonStyle.Secondary);
}

function buildDashboardEmbed(targetUser, qrObj) {
  if (!hasQrData(qrObj)) {
    return buildEmptyEmbed(targetUser);
  }

  const embed = createQrEmbed(qrObj);
  embed
    .setColor(0xff69b4)
    .setTitle(`📱 QR thanh toán của ${targetUser.tag}`)
    .setDescription("Quản lý QR hiện tại bằng các nút bên dưới.");

  const statusText = qrObj.bankCode && qrObj.account ? "VietQR động" : "QR text fallback";
  embed.addFields(
    { name: "Người quản lý", value: `<@${targetUser.id}>`, inline: true },
    { name: "Trạng thái", value: statusText, inline: true },
    {
      name: "Mã ngân hàng",
      value: qrObj.bankCode || "Chưa có",
      inline: true,
    },
  );

  return embed;
}

async function buildQrAttachment(config, qrObj) {
  if (!qrObj) return null;

  const { QRCode, AttachmentBuilder } = config;
  const bankName = qrObj.accountName || qrObj.bank || "";
  const qrContent = qrObj.qrContent || qrObj.url || "";

  if (qrObj.bankCode && qrObj.account) {
    try {
      const qrBuffer = await generateVietQrBuffer({
        bankCode: qrObj.bankCode,
        accountNumber: qrObj.account,
        accountName: bankName,
        amount: 0,
        addInfo: qrContent || bankName || qrObj.account,
      });

      return new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
    } catch {
      const vietQrImageUrl = buildVietQrImageUrl({
        bankCode: qrObj.bankCode,
        accountNumber: qrObj.account,
        accountName: bankName,
        amount: 0,
        addInfo: qrContent || bankName || qrObj.account,
      });

      if (vietQrImageUrl) {
        const qrBuffer = await fetchImageBuffer(vietQrImageUrl);
        return new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
      }
    }
  }

  const fallbackValue = qrContent || `${qrObj.bank || ""} ${qrObj.account || ""}`.trim();
  if (!fallbackValue) return null;

  const qrBuffer = await QRCode.toBuffer(fallbackValue, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  return new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
}

async function editMessage(interaction, payload) {
  if (!interaction.message || typeof interaction.message.edit !== "function") {
    throw new Error("Thiếu message nguồn để cập nhật QR dashboard");
  }

  return interaction.message.edit(payload);
}

async function renderDashboard(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên QR đã hết hạn, hãy chạy /qr lại nhé.",
      ephemeral: true,
    });
  }

  const targetUser = await interaction.client.users.fetch(session.targetUserId);
  const qrObj = config.qrDataService.getQr(session.targetUserId);
  const attachment = await buildQrAttachment(config, qrObj);
  const embed = buildDashboardEmbed(targetUser, qrObj);

  session.mode = "dashboard";

  const payload = {
    embeds: [embed],
    components: [buildDashboardButtons(sessionId, hasQrData(qrObj))],
  };

  if (attachment) {
    payload.files = [attachment];
    embed.setImage("attachment://my_qr.png");
  }

  return editMessage(interaction, payload);
}

async function renderEditPanel(interaction, config, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên QR đã hết hạn, hãy chạy /qr lại nhé.",
      ephemeral: true,
    });
  }

  const targetUser = await interaction.client.users.fetch(session.targetUserId);
  const qrObj = session.draft ? cloneQr(session.draft) : cloneQr(config.qrDataService.getQr(session.targetUserId));
  const hasQr = hasQrData(qrObj);

  session.mode = "edit";

  const embed = hasQr
    ? buildDashboardEmbed(targetUser, qrObj)
    : new EmbedBuilder()
        .setColor("Blue")
        .setTitle(`🛠️ Thiết lập QR cho ${targetUser.tag}`)
        .setDescription(
          "Chưa có QR. Chọn các nút chỉnh sửa bên dưới để bắt đầu thiết lập từng trường.",
        )
        .addFields(
          { name: "Bước 1", value: "Sửa Tên/Chủ TK", inline: true },
          { name: "Bước 2", value: "Sửa Số TK", inline: true },
          { name: "Bước 3", value: "Sửa bank_code", inline: true },
        )
        .setTimestamp();

  const attachment = hasQr ? await buildQrAttachment(config, qrObj) : null;
  const payload = {
    embeds: [embed],
    components: [
      createEditButtons(session.targetUserId),
      buildEditActionButtons(sessionId),
    ],
  };

  if (attachment) {
    payload.files = [attachment];
    if (hasQr) {
      embed.setImage("attachment://my_qr.png");
    }
  }

  return editMessage(interaction, payload);
}

function buildBankSelectionEmbed(targetUser, qrObj, pageLabel, selectedBank) {
  const title = `🏦 Chọn ngân hàng cho ${targetUser.tag}`;
  const selectedLabel = selectedBank
    ? `${selectedBank.shortName || selectedBank.code || selectedBank.name} (${selectedBank.bin})`
    : qrObj.bankCode
      ? `Đang chọn: ${qrObj.bankName || "Ngân hàng đã lưu"} (${qrObj.bankCode})`
      : "Chưa chọn ngân hàng nào";

  return new EmbedBuilder()
    .setColor("Blue")
    .setTitle(title)
    .setDescription(
      "Chọn đúng ngân hàng từ danh sách bên dưới. Mã bank_code sẽ được điền tự động để `/pay` tạo QR động chính xác.",
    )
    .addFields(
      { name: "Trạng thái", value: selectedLabel, inline: false },
      { name: "Trang", value: pageLabel, inline: true },
      { name: "Lưu ý", value: "Chọn xong sẽ quay lại màn hình chỉnh sửa QR.", inline: true },
    )
    .setTimestamp();
}

async function renderBankSelection(interaction, config, sessionId, page = 0) {
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên QR đã hết hạn, hãy chạy /qr lại nhé.",
      ephemeral: true,
    });
  }

  const targetUser = await interaction.client.users.fetch(session.targetUserId);
  const qrObj = session.draft ? cloneQr(session.draft) : cloneQr(config.qrDataService.getQr(session.targetUserId));
  let banks;
  try {
    banks = await resolveBankList(config);
  } catch (error) {
    return editMessage(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor("Red")
          .setTitle(`🏦 Chọn ngân hàng cho ${targetUser.tag}`)
          .setDescription(`Không tải được danh sách ngân hàng từ VietQR: ${error.message}`)
          .setTimestamp(),
      ],
      components: [buildEditActionButtons(sessionId)],
    });
  }
  if (!banks.length) {
    return editMessage(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor("Red")
          .setTitle(`🏦 Chọn ngân hàng cho ${targetUser.tag}`)
          .setDescription("Không tải được danh sách ngân hàng từ VietQR. Thử lại sau nhé.")
          .setTimestamp(),
      ],
      components: [buildEditActionButtons(sessionId)],
    });
  }

  const totalPages = Math.max(1, Math.ceil(banks.length / 25));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageBanks = banks.slice(currentPage * 25, currentPage * 25 + 25);
  session.mode = "bank-select";
  session.bankPage = currentPage;

  const selectedBank = pageBanks.find((bank) => bank.bin === qrObj.bankCode) || null;

  return editMessage(interaction, {
    embeds: [buildBankSelectionEmbed(targetUser, qrObj, buildBankPageLabel(currentPage, totalPages), selectedBank)],
    components: [
      buildBankSelectRows(sessionId, pageBanks, currentPage),
      buildBankNavigationRow(sessionId, currentPage, totalPages),
    ],
  });
}

async function handleQrDashboardCommand(interaction, config) {
  if (!ensureAllowed(interaction, config)) {
    return interaction.reply({
      content: "Bạn không có quyền admin!",
      ephemeral: true,
    });
  }

  const targetUser = await getTargetUser(interaction, config);
  if (!targetUser) {
    return interaction.reply({
      content: "Không tìm thấy người dùng cần quản lý QR!",
      ephemeral: true,
    });
  }

  const sessionId = interaction.id;
  createSession(sessionId, interaction.user.id, targetUser.id);

  const qrObj = config.qrDataService.getQr(targetUser.id);
  const attachment = await buildQrAttachment(config, qrObj);
  const embed = buildDashboardEmbed(targetUser, qrObj);

  const replyPayload = {
    embeds: [embed],
    components: [buildDashboardButtons(sessionId, hasQrData(qrObj))],
    fetchReply: true,
    ephemeral: false,
  };

  if (attachment) {
    replyPayload.files = [attachment];
    embed.setImage("attachment://my_qr.png");
  }

  const replyMessage = await interaction.editReply(replyPayload);
  const session = getSession(sessionId);
  if (session) {
    session.messageId = replyMessage.id;
    session.draft = cloneQr(qrObj);
  }
}

async function handleQrDashboardButton(interaction, config) {
  const parsed = parseQrDashboardCustomId(interaction.customId);
  if (!parsed) return;

  const session = getSession(parsed.sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên QR đã hết hạn, hãy chạy /qr lại nhé.",
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

  if (parsed.action === "edit") {
    await interaction.deferUpdate();
    return renderEditPanel(interaction, config, parsed.sessionId);
  }

  if (parsed.action === "bank") {
    await interaction.deferUpdate();
    return renderBankSelection(interaction, config, parsed.sessionId, 0);
  }

  if (parsed.action === "bankprev" || parsed.action === "banknext") {
    const session = getSession(parsed.sessionId);
    if (!session) {
      return interaction.reply({
        content: "Phiên QR đã hết hạn, hãy chạy /qr lại nhé.",
        ephemeral: true,
      });
    }
    const nextPage =
      parsed.action === "bankprev"
        ? Math.max(0, (session.bankPage || 0) - 1)
        : (session.bankPage || 0) + 1;

    await interaction.deferUpdate();
    return renderBankSelection(interaction, config, parsed.sessionId, nextPage);
  }

  if (parsed.action === "save") {
    const draft = session.draft ? cloneQr(session.draft) : createBlankQr();
    if (!draft.bankCode || !draft.account) {
      return interaction.reply({
        content:
          "Cần có bank_code và account_number trước khi lưu QR. Hãy điền đủ rồi bấm Lưu thay đổi nhé.",
        ephemeral: true,
      });
    }

    await interaction.deferUpdate();
    config.qrDataService.setQr(session.targetUserId, draft);
    await config.qrDataService.saveQrDataToSheet(config.SHEETS_ID);
    await config.logger.info(
      `[qr] Admin ${interaction.user.tag} lưu QR của ${session.targetUserId}`,
      config.SHEETS_ID,
    );
    session.draft = cloneQr(draft);
    return renderDashboard(interaction, config, parsed.sessionId);
  }

  if (parsed.action === "back") {
    await interaction.deferUpdate();
    return renderDashboard(interaction, config, parsed.sessionId);
  }

  if (parsed.action === "remove") {
    const qrObj = config.qrDataService.getQr(session.targetUserId);
    if (!qrObj) {
      return interaction.reply({
        content: "Người dùng này chưa có QR để xóa!",
        ephemeral: true,
      });
    }

    await interaction.deferUpdate();
    config.qrDataService.deleteQr(session.targetUserId);
    await config.qrDataService.saveQrDataToSheet(config.SHEETS_ID);
    await config.logger.info(
      `[qr] Admin ${interaction.user.tag} xóa QR của ${session.targetUserId}`,
      config.SHEETS_ID,
    );

    return renderDashboard(interaction, config, parsed.sessionId);
  }
}

async function handleQrDashboardSelectMenu(interaction, config) {
  if (!isQrDashboardSelectMenu(interaction.customId)) return;

  const parsed = /^qr_dashboard_bank_(.+)$/.exec(String(interaction.customId || ""));
  if (!parsed) return;

  const sessionId = parsed[1];
  const session = getSession(sessionId);
  if (!session) {
    return interaction.reply({
      content: "Phiên QR đã hết hạn, hãy chạy /qr lại nhé.",
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

  const selectedBin = String(interaction.values?.[0] || "").trim();
  if (!selectedBin) {
    return interaction.reply({
      content: "Bạn chưa chọn ngân hàng nào!",
      ephemeral: true,
    });
  }

  let banks;
  try {
    banks = await resolveBankList(config);
  } catch (error) {
    return interaction.reply({
      content: `Không tải được danh sách ngân hàng từ VietQR: ${error.message}`,
      ephemeral: true,
    });
  }
  const selectedBank = banks.find((bank) => bank.bin === selectedBin);
  if (!selectedBank) {
    return interaction.reply({
      content: `Không tìm thấy bank_code ${selectedBin} trong danh sách VietQR!`,
      ephemeral: true,
    });
  }

  setSessionDraftField(session.sessionId, "bankCode", selectedBank.bin);
  setSessionDraftField(session.sessionId, "bankName", selectedBank.shortName || selectedBank.name);
  setSessionDraftField(session.sessionId, "logo", selectedBank.logo || "");

  await interaction.deferUpdate();
  return renderEditPanel(interaction, config, sessionId);
}

module.exports = {
  handleQrDashboardCommand,
  handleQrDashboardButton,
  handleQrDashboardSelectMenu,
  renderBankSelection,
  isQrDashboardButton,
  isQrDashboardSelectMenu,
  buildEditActionButtons,
  getSession,
  findSessionByTargetUserId,
  setSessionDraftField,
  resetSessionDraft,
  cloneQr,
  createBlankQr,
  getDraftForTargetUser,
};
