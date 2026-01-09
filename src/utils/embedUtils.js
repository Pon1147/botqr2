// src/utils/embedUtils.js - Các hàm tiện ích tạo embed, button, modal và parse customId

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

/**
 * Tạo embed hiển thị QR code
 * @param {Object} qrObj - { bank, account, url, logo }
 * @returns {EmbedBuilder}
 */
function createQrEmbed(qrObj) {
  const { bank, account, logo } = qrObj;
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
      text: "Vui lòng kiểm tra thật kỹ khi chuyển khoản và gửi bill sau khi thanh toán thành công",
    })
    .setThumbnail(logo || null);
}

/**
 * Tạo hàng button chỉnh sửa QR
 * @param {string} userId
 * @returns {ActionRowBuilder}
 */
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

/**
 * Tạo modal chỉnh sửa một trường
 * @param {string} customId
 * @param {string} title
 * @param {string} placeholder
 * @returns {ModalBuilder}
 */
function createEditModal(customId, title, placeholder = "") {
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

/**
 * Parse customId dạng action_userId
 * @param {string} customId
 * @returns {{ action: string, userId: string }}
 */
function parseCustomId(customId) {
  const match = customId.match(/^(.+)_(\d+)$/);
  if (!match) {
    throw new Error(`Invalid customId format: ${customId}`);
  }
  return { action: match[1], userId: match[2] };
}

module.exports = {
  createQrEmbed,
  createEditButtons,
  createEditModal,
  parseCustomId,
};
