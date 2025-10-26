const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-confirm")
    .setDescription("Xác nhận thanh toán thành công (admin only)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch")
        .setRequired(true)
    ),
  adminOnly: true,
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
    createEditButtons,
    getSortedPayments
  ) {
    await interaction.deferReply();

    const txCode = interaction.options.getString("transaction_code").toUpperCase();
    const tx = paymentsData.find((t) => t.id === txCode);

    if (!tx || tx.status !== "pending") {
      return interaction.editReply({
        content: "Giao dịch không tồn tại hoặc đã xử lý!",
        ephemeral: true,
      });
    }

    tx.status = "confirmed";
    tx.processedDate = new Date().toISOString();
    await savePaymentsData(tx);

    // Lấy tag của seller từ DEFAULT_SELLER_ID
    let sellerTag = "Seller Fixed";
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag; // Lấy username#discriminator
      } catch (error) {
        console.error(`[${new Date().toLocaleString("vi-VN")}] [ERROR] [payment-confirm] Lỗi khi lấy thông tin seller: ${error.message}`);
        await logMessage("ERROR", `Lỗi khi lấy thông tin seller từ ID ${sellerId}: ${error.message}`);
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("✅ Thanh toán xác nhận")
      .addFields(
        { name: "Mã TX", value: tx.id, inline: true },
        { name: "Số tiền", value: `${tx.amount.toLocaleString()} VNĐ`, inline: true },
        { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true },
        { name: "Seller", value: sellerTag, inline: true },
        { name: "Mô tả", value: tx.description },
        { name: "Ngày xử lý", value: new Date(tx.processedDate).toLocaleDateString("vi-VN"), inline: true }
      )
      .setColor("Green")
      .setTimestamp();

    await logMessage(
      "INFO",
      `[payment-confirm] Admin ${interaction.user.tag} xác nhận TX ${txCode} (Buyer: ${tx.buyerId})`
    );
    await interaction.editReply({
      embeds: [embed],
      content: `<@${tx.buyerId}> Thanh toán đã xác nhận!`,
      ephemeral: false,
    });
  },
};