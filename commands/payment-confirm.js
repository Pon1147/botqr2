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
    createEditButtons
  ) {
    await interaction.deferReply();

    const txCode = interaction.options
      .getString("transaction_code")
      .toUpperCase();
    const tx = paymentsData.find((t) => t.id === txCode);

    if (!tx || tx.status !== "pending") {
      return interaction.editReply({
        content: "Giao dịch không tồn tại hoặc đã xử lý!",
        ephemeral: true,
      });
    }

    tx.status = "confirmed";
    tx.processedDate = new Date().toISOString();
    paymentsData.sort((a, b) => new Date(b.date) - new Date(a.date));
    await savePaymentsData();

    const embed = new EmbedBuilder()
      .setTitle("✅ Thanh toán xác nhận")
      .addFields(
        { name: "Mã TX", value: tx.id, inline: true },
        {
          name: "Số tiền",
          value: `${tx.amount.toLocaleString()} VNĐ`,
          inline: true,
        },
        { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true },
        { name: "Seller", value: `<@${tx.sellerId}>`, inline: true },
        { name: "Mô tả", value: tx.description }
      )
      .setColor("Green")
      .setTimestamp();

    await logMessage(
      `[payment-confirm] Admin ${interaction.user.tag} xác nhận TX ${txCode} (Seller: ${tx.sellerId}, Buyer: ${tx.buyerId})`
    );
    await interaction.editReply({
      embeds: [embed],
      content: `<@${tx.buyerId}> <@${tx.sellerId}>`, // Notify mention
    });
  },
};
