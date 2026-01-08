const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("Hủy/từ chối giao dịch (admin only)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Lý do hủy").setRequired(true)
    ),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const txCode = interaction.options
      .getString("transaction_code")
      .toUpperCase();
    const reason = interaction.options.getString("reason");

    const tx = paymentService.getSortedPayments().find((t) => t.id === txCode);

    if (!tx || tx.status !== "pending") {
      return interaction.editReply({
        content: "Giao dịch không tồn tại hoặc đã xử lý!",
        ephemeral: true,
      });
    }

    tx.status = "cancelled";
    tx.processedDate = new Date().toISOString();
    tx.reason = reason;

    await paymentService.savePaymentsToSheet(SHEETS_ID); // Save toàn bộ sau update

    let sellerTag = "Seller Fixed";
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag;
      } catch (error) {
        await logger.error(
          `Lỗi lấy seller info khi cancel TX ${txCode}: ${error.message}`,
          SHEETS_ID
        );
      }
    }

    const embed = new EmbedBuilder()
      .setTitle("❌ Giao dịch hủy")
      .addFields(
        { name: "Mã TX", value: tx.id, inline: true },
        {
          name: "Số tiền",
          value: `${tx.amount.toLocaleString()} VNĐ`,
          inline: true,
        },
        { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true },
        { name: "Seller", value: sellerTag, inline: true },
        { name: "Lý do", value: reason }
      )
      .setColor("Red")
      .setTimestamp();

    await logger.info(
      `[cancel] Admin ${interaction.user.tag} hủy TX ${txCode} (Buyer: ${tx.buyerId}): ${reason}`,
      SHEETS_ID
    );

    await interaction.editReply({
      embeds: [embed],
      content: `<@${tx.buyerId}> Giao dịch đã hủy: ${reason}`,
      ephemeral: false,
    });
  },
};
