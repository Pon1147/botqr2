const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Xóa hẳn một payment đã confirm (admin only)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
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
  ephemeral: false,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const txIdRaw = interaction.options.getString("transaction_code");
    if (!txIdRaw) {
      return interaction.editReply({
        content: "Vui lòng nhập mã TX!",
        ephemeral: true,
      });
    }
    const txId = txIdRaw.toUpperCase().trim();

    const reason = interaction.options.getString("reason")?.trim() || "Không có lý do";

    const existingTx = paymentService.getPaymentById(txId);
    if (!existingTx) {
      return interaction.editReply({
        content: `Không tìm thấy payment với mã **${txId}**.`,
        ephemeral: true,
      });
    }

    if (existingTx.status !== "confirmed") {
      return interaction.editReply({
        content: `Chỉ có thể xóa payment đã **confirmed**. Mã **${txId}** hiện tại là **${existingTx.status}**.`,
        ephemeral: true,
      });
    }

    const removedTx = paymentService.removePaymentById(txId);
    if (!removedTx) {
      return interaction.editReply({
        content: `Không thể xóa payment **${txId}**. Thử lại sau.`,
        ephemeral: true,
      });
    }

    await paymentService.savePaymentsToSheet(SHEETS_ID);

    let sellerTag = "Seller Fixed";
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag;
      } catch (error) {
        await logger.error(
          `Lỗi lấy seller info khi remove TX ${txId}: ${error.message}`,
          SHEETS_ID
        );
      }
    }

    await logger.info(
      `[remove] Admin ${interaction.user.tag} (${interaction.user.id}) đã xóa TX ${txId}: ${removedTx.amount.toLocaleString()} VND - Buyer <@${removedTx.buyerId}> - Seller ${sellerTag} - Lý do: ${reason}`,
      SHEETS_ID
    );

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("Payment đã bị xóa bởi Admin")
      .setDescription(
        `Mã giao dịch **${txId}** đã bị xóa khỏi hệ thống vì lý do khách quan.`
      )
      .addFields(
        {
          name: "Số tiền",
          value: `${removedTx.amount.toLocaleString()} VND`,
          inline: true,
        },
        { name: "Buyer", value: `<@${removedTx.buyerId}>`, inline: true },
        { name: "Seller", value: sellerTag, inline: true },
        {
          name: "Mô tả",
          value: removedTx.description || "Không có",
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
      .setFooter({ text: "Bot QR - Payment Management" });

    await interaction.editReply({
      embeds: [embed],
      content: `<@${removedTx.buyerId}> Thanh toán của bạn (mã **${txId}**) đã bị admin xóa vì: **${reason}**.`,
      ephemeral: false,
    });
  },
};

