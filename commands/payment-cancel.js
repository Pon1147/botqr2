const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-cancel")
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

    const txCode = interaction.options
      .getString("transaction_code")
      .toUpperCase();
    const reason = interaction.options.getString("reason");
    const tx = paymentsData.find((t) => t.id === txCode);

    if (!tx || tx.status !== "pending") {
      return interaction.editReply({
        content: "Giao dịch không tồn tại hoặc đã xử lý!",
        ephemeral: true,
      });
    }

    tx.status = "cancelled";
    tx.processedDate = new Date().toISOString();
    tx.reason = reason;
    await savePaymentsData(tx); // Pass updated tx for sync

    const sellerTag = process.env.DEFAULT_SELLER_TAG || "Seller Fixed";

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

    await logMessage(
      "INFO",
      `[payment-cancel] Admin ${interaction.user.tag} hủy TX ${txCode} (Buyer: ${tx.buyerId}): ${reason}`
    );
    await interaction.editReply({
      embeds: [embed],
      content: `<@${tx.buyerId}> Giao dịch đã hủy: ${reason}`,
      ephemeral: false,
    });
  },
};
