const { MessageFlags } = require("discord.js");
const {
  findSessionByTargetUserId,
  getSession,
  setSessionDraftField,
  cloneQr,
  createBlankQr,
  renderBankSelection,
} = require("./qrDashboardFlow");
const {
  buildVietQrImageUrl,
  fetchImageBuffer,
  generateVietQrBuffer,
} = require("../utils/vietqrUtils");

function isQrButton(customId) {
  return customId.startsWith("edit_") || customId.startsWith("reset_");
}

function isQrModal(customId) {
  return customId.startsWith("modal_");
}

function parseQrModalCustomId(customId) {
  const match = /^modal_(bank|account|bankcode|url)_(\d+)(?:_(.+))?$/.exec(String(customId || ""));
  if (!match) return null;
  return { modalType: `modal_${match[1]}`, userId: match[2], sessionId: match[3] || null };
}

async function buildQrPreviewAttachment(config, qrObj) {
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
      return new config.AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
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
        return new config.AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
      }
    }
  }

  const fallbackValue = qrContent || `${qrObj.bank || ""} ${qrObj.account || ""}`.trim();
  if (!fallbackValue) return null;

  const qrBuffer = await config.QRCode.toBuffer(fallbackValue, {
    width: 256,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  return new config.AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
}

async function handleQrButton(interaction, config) {
  const { qrDataService, createEditModal, SHEETS_ID } = config;
  const { action, userId } = config.parseCustomId(interaction.customId);
  const session = findSessionByTargetUserId(userId);
  const isDashboardSession = Boolean(session);
  const isAllowed = isDashboardSession
    ? interaction.user.id === session.userId
    : interaction.user.id === userId;

  if (!interaction.user.id || !isAllowed) {
    return interaction.reply({
      content: "Đây không phải nút của bạn!",
      ephemeral: true,
    });
  }

  const qrObj = qrDataService.getQr(userId);
  const draftObj = isDashboardSession && session?.draft ? cloneQr(session.draft) : cloneQr(qrObj);
  const fallbackQrObj = draftObj || createBlankQr();
  const modalSuffix = isDashboardSession && session ? `_${session.sessionId}` : "";

  switch (action) {
    case "edit_bank":
      return interaction.showModal(
        createEditModal(
          `modal_bank_${userId}${modalSuffix}`,
          "Sửa Tên Chủ TK",
          "Nhập tên chủ tài khoản",
          fallbackQrObj.bank || "",
        ),
      );
    case "edit_account":
      return interaction.showModal(
        createEditModal(
          `modal_account_${userId}${modalSuffix}`,
          "Sửa Số Tài Khoản",
          "Nhập số tài khoản",
          fallbackQrObj.account || "",
        ),
      );
    case "edit_bankcode":
      if (session) {
        await interaction.deferUpdate();
        return renderBankSelection(
          interaction,
          config,
          session.sessionId,
          session.bankPage || 0,
        );
      }
      return interaction.showModal(
        createEditModal(
          `modal_bankcode_${userId}${modalSuffix}`,
          "Sửa bank_code",
          "Nhập bank code của ngân hàng",
          fallbackQrObj.bankCode || "",
        ),
      );
    case "reset":
      if (!qrObj && !session) {
        return interaction.reply({
          content: "User này chưa có QR!",
          ephemeral: true,
        });
      }

      if (isDashboardSession && session) {
        setSessionDraftField(session.sessionId, "bank", "");
        setSessionDraftField(session.sessionId, "account", "");
        setSessionDraftField(session.sessionId, "url", "");
        setSessionDraftField(session.sessionId, "logo", "");
        setSessionDraftField(session.sessionId, "bankCode", "");
        setSessionDraftField(session.sessionId, "bankName", "");
        setSessionDraftField(session.sessionId, "accountName", "");
        setSessionDraftField(session.sessionId, "qrContent", "");
        return interaction.reply({
          content:
            "Đã đưa QR về trạng thái trống trong phiên chỉnh sửa, bấm Lưu thay đổi để cập nhật.",
          ephemeral: true,
        });
      }

      qrDataService.deleteQr(userId);
      await qrDataService.saveQrDataToSheet(SHEETS_ID);
      return interaction.update({
        content: "Đã reset toàn bộ QR!",
        components: [],
      });
    default:
      return;
  }
}

async function handleQrModal(interaction, config) {
  const {
    qrDataService,
    QRCode,
    createQrEmbed,
    createEditButtons,
    AttachmentBuilder,
    SHEETS_ID,
  } = config;

  const parsed = parseQrModalCustomId(interaction.customId);
  if (!parsed) return;

  const { modalType, userId, sessionId } = parsed;
  const value = interaction.fields.getTextInputValue("input_value");
  const qrObj = qrDataService.getQr(userId);
  const session = sessionId ? getSession(sessionId) : null;
  const mutableQrObj = session?.draft ? cloneQr(session.draft) : cloneQr(qrObj);

  let updated = false;
  switch (modalType) {
    case "modal_bank":
      mutableQrObj.bank = value;
      updated = true;
      break;
    case "modal_account":
      mutableQrObj.account = value;
      updated = true;
      break;
    case "modal_bankcode":
      mutableQrObj.bankCode = value.trim();
      updated = true;
      break;
    case "modal_url":
      try {
        new URL(value.startsWith("http") ? value : `http://${value}`);
        mutableQrObj.url = value;
        updated = true;
      } catch {
        await interaction.reply({
          content: "URL không hợp lệ!",
          ephemeral: true,
        });
        return;
      }
      break;
    default:
      return;
  }

  if (session) {
    setSessionDraftField(session.sessionId, "bank", mutableQrObj.bank);
    setSessionDraftField(session.sessionId, "account", mutableQrObj.account);
    setSessionDraftField(session.sessionId, "url", mutableQrObj.url);
    setSessionDraftField(session.sessionId, "logo", mutableQrObj.logo);
    setSessionDraftField(session.sessionId, "bankCode", mutableQrObj.bankCode);
    setSessionDraftField(session.sessionId, "accountName", mutableQrObj.accountName);
    setSessionDraftField(session.sessionId, "qrContent", mutableQrObj.qrContent);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({
      content: "Đã cập nhật bản nháp. Bấm Lưu thay đổi để ghi xuống Sheets nhé.",
    });
    return;
  }

  if (!updated) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const attachment = await buildQrPreviewAttachment(config, mutableQrObj);
  const embed = createQrEmbed(mutableQrObj);
  const components = [createEditButtons(userId)];

  qrDataService.setQr(userId, mutableQrObj);
  await qrDataService.saveQrDataToSheet(SHEETS_ID);
  await interaction.editReply({
    embeds: [embed],
    files: attachment ? [attachment] : undefined,
    components,
  });
}

module.exports = {
  handleQrButton,
  handleQrModal,
  isQrButton,
  isQrModal,
};
