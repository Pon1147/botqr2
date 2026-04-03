const { MessageFlags } = require("discord.js");

function isQrButton(customId) {
  return customId.startsWith("edit_") || customId.startsWith("reset_");
}

function isQrModal(customId) {
  return customId.startsWith("modal_");
}

async function handleQrButton(interaction, config) {
  const { qrDataService, createEditModal, SHEETS_ID } = config;

  const { action, userId } = config.parseCustomId(interaction.customId);

  if (!interaction.user.id || interaction.user.id !== userId) {
    return interaction.reply({
      content: "Đây không phải nút của bạn!",
      ephemeral: true,
    });
  }

  const qrObj = qrDataService.getQr(userId);
  if (!qrObj) {
    return interaction.reply({
      content: "Không tìm thấy dữ liệu QR!",
      ephemeral: true,
    });
  }

  switch (action) {
    case "edit_bank":
      return interaction.showModal(
        createEditModal(`modal_bank_${userId}`, "Sửa Tên Chủ TK", qrObj.bank || ""),
      );
    case "edit_account":
      return interaction.showModal(
        createEditModal(`modal_account_${userId}`, "Sửa Số Tài Khoản", qrObj.account || ""),
      );
    case "edit_url":
      return interaction.showModal(
        createEditModal(`modal_url_${userId}`, "Sửa URL/QR", qrObj.url || ""),
      );
    case "reset":
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

  const { action: modalType, userId } = config.parseCustomId(interaction.customId);
  const value = interaction.fields.getTextInputValue("input_value");
  const qrObj = qrDataService.getQr(userId);

  if (!qrObj) {
    return interaction.reply({
      content: "Không tìm thấy dữ liệu QR!",
      ephemeral: true,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
        new URL(value.startsWith("http") ? value : `http://${value}`);
        qrObj.url = value;
        updated = true;
      } catch {
        return interaction.followUp({
          content: "URL không hợp lệ!",
          ephemeral: true,
        });
      }
      break;
    default:
      return;
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
    const embed = createQrEmbed(qrObj);
    const components = [createEditButtons(userId)];

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components,
    });
  }
}

module.exports = {
  handleQrButton,
  handleQrModal,
  isQrButton,
  isQrModal,
};
