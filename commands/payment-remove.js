const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-remove")
    .setDescription("Xóa hẳn một payment đã confirm (admin only)")
    .addStringOption((option) =>
      option
        .setName("id")
        .setDescription("Mã TX cần xóa (ví dụ: TXA1B2C3D4)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Lý do xóa (khách quan)")
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
    await interaction.deferReply({ ephemeral: false });

    const txId = interaction.options.getString("id").toUpperCase().trim();
    const reason = interaction.options.getString("reason").trim();

    const paymentIndex = paymentsData.findIndex((tx) => tx.id === txId);
    if (paymentIndex === -1) {
      return interaction.editReply({
        content: `Không tìm thấy payment với mã **${txId}**.`,
        ephemeral: true,
      });
    }

    const payment = paymentsData[paymentIndex];

    if (payment.status !== "confirmed") {
      return interaction.editReply({
        content: `Chỉ có thể xóa payment đã **confirmed**. Mã **${txId}** hiện tại là **${payment.status}**.`,
        ephemeral: true,
      });
    }

    // Xóa khỏi array
    paymentsData.splice(paymentIndex, 1);

    // Save lại toàn bộ → hàm savePaymentsToSheet sẽ tự tính lại totalConfirmedAmount
    await savePaymentsData();

    // Lấy seller tag giống payment-confirm
    let sellerTag = "Seller Fixed";
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag;
      } catch (error) {
        await logMessage(
          "ERROR",
          `Lỗi lấy seller info khi remove TX ${txId}: ${error.message}`
        );
      }
    }

    // Log chi tiết
    await logMessage(
      "INFO",
      `[payment-remove] Admin ${interaction.user.tag} (${
        interaction.user.id
      }) đã xóa TX ${txId}: ${payment.amount.toLocaleString()} VNĐ - Buyer <@${
        payment.buyerId
      }> - Seller ${sellerTag} - Lý do: ${reason}`
    );

    // Embed thông báo public
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("🗑️ Payment đã bị xóa bởi Admin")
      .setDescription(
        `Mã giao dịch **${txId}** đã bị xóa khỏi hệ thống vì lý do khách quan.`
      )
      .addFields(
        {
          name: "Số tiền",
          value: `${payment.amount.toLocaleString()} VNĐ`,
          inline: true,
        },
        { name: "Buyer", value: `<@${payment.buyerId}>`, inline: true },
        { name: "Seller", value: sellerTag, inline: true },
        {
          name: "Mô tả",
          value: payment.description || "Không có",
          inline: false,
        },
        { name: "Lý do xóa", value: reason, inline: false },
        {
          name: "Thực hiện bởi",
          value: `<@${interaction.user.id}>`,
          inline: false,
        }
      )
      .setTimestamp()
      .setFooter({ text: "Hệ thống Bot QR - Payment Management" });

    await interaction.editReply({
      embeds: [embed],
      content: `<@${payment.buyerId}> Thanh toán của bạn (mã **${txId}**) đã bị admin xóa vì: **${reason}**. Liên hệ admin nếu cần làm rõ!`,
    });
  },
};
