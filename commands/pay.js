// commands/pay.js - User Command (Seller tạo invoice cho buyer)
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Tạo yêu cầu thanh toán (seller tạo invoice cho buyer)")
    .addUserOption((option) =>
      option
        .setName("buyer")
        .setDescription("Người trả tiền (buyer)")
        .setRequired(true)
    ) // Option buyer (người trả)
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Số tiền (VNĐ)").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Mô tả giao dịch")
        .setRequired(true)
    ),
  adminOnly: false,
  async execute(
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
  ) {
    const buyer = interaction.options.getUser("buyer");
    const amount = interaction.options.getInteger("amount");
    const description = interaction.options.getString("description");
    const sellerId = interaction.user.id; // Người gọi = seller
    const buyerId = buyer.id; // Option = buyer
    const sellerTag = interaction.user.tag;
    const buyerTag = buyer.tag;
    const txId = `TX${Date.now()}${Math.random()
      .toString(36)
      .substr(2, 5)
      .toUpperCase()}`;

    // Kiểm tra seller có QR
    if (!userQrData.has(sellerId)) {
      return interaction.reply({
        content: "Bạn (seller) chưa set QR! Dùng /setqr trước.",
        ephemeral: true,
      });
    }

    const newTx = {
      id: txId,
      sellerId,
      buyerId,
      amount,
      description,
      status: "pending",
      date: new Date().toISOString(),
    };

    paymentsData.unshift(newTx);
    await savePaymentsData();

    const embed = new EmbedBuilder()
      .setTitle("💳 Yêu cầu thanh toán (Invoice)")
      .addFields(
        { name: "Mã TX", value: txId, inline: true },
        {
          name: "Số tiền",
          value: `${amount.toLocaleString()} VNĐ`,
          inline: true,
        },
        { name: "Từ (Buyer)", value: `<@${buyerId}>`, inline: true },
        { name: "Đến (Seller)", value: `<@${sellerId}>`, inline: true },
        { name: "Mô tả", value: description },
        { name: "Trạng thái", value: "⏳ Chờ buyer quét QR và admin xác nhận" }
      )
      .setColor("Blue")
      .setTimestamp();

    await logMessage(
      `[pay] Seller ${sellerTag} (${sellerId}) tạo TX ${txId} cho Buyer ${buyerTag} (${buyerId}): ${amount} VNĐ - ${description}`
    );
    await interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
