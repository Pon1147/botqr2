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
      { name: "Tên Chủ Tài Khoản", value: bank || "Chưa thiết lập", inline: false },
      { name: "Số Tài Khoản", value: account || "Chưa thiết lập", inline: false },
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
      .setLabel("Sửa Tên/Chủ TK")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`edit_account_${userId}`)
      .setLabel("Sửa Số TK")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`edit_url_${userId}`)
      .setLabel("Sửa URL/QR")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reset_${userId}`)
      .setLabel("Đặt Lại")
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

function buildStarText(rating) {
  const safeRating = Number.isInteger(rating) ? Math.max(1, Math.min(5, rating)) : 1;
  return `${safeRating}/5 sao`;
}

/**
 * Tạo embed cảm ơn user sau khi gửi feedback
 * @param {string} username
 * @returns {EmbedBuilder}
 */
function createFeedbackThanksEmbed(username) {
  return new EmbedBuilder()
    .setColor("Green")
    .setTitle("✅ Đã ghi nhận đánh giá")
    .setDescription(`Cảm ơn **${username}**! Đánh giá của bạn đã được ghi nhận.`)
    .setTimestamp();
}

/**
 * Tạo embed công khai tới kênh feedback
 * @param {{ username: string; rating: number; comment: string; orderItems: string; txId: string }} payload
 * @returns {EmbedBuilder}
 */
function createFeedbackPublicEmbed(payload) {
  const { username, rating, comment, orderItems, txId } = payload;

  return new EmbedBuilder()
    .setColor("Blue")
    .setTitle("Đánh giá quy trình mua hàng")
    .addFields(
      { name: "Khách hàng", value: username || "Không rõ", inline: true },
      { name: "Số sao", value: buildStarText(rating), inline: true },
      { name: "Mã TX", value: txId || "Không có", inline: true },
      { name: "Đơn hàng", value: orderItems || "Không có", inline: false },
      { name: "Nhận xét", value: comment || "Không có", inline: false }
    )
    .setTimestamp();
}

module.exports = {
  createQrEmbed,
  createEditButtons,
  createEditModal,
  parseCustomId,
  createFeedbackThanksEmbed,
  createFeedbackPublicEmbed,
};
