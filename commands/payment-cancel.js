// commands/payment-cancel.js - Public Command
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-cancel")
    .setDescription("Hủy/từ chối giao dịch (cho TX của bạn)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Lý do hủy").setRequired(true)
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
    const txCode = interaction.options
      .getString("transaction_code")
      .toUpperCase();
    const reason = interaction.options.getString("reason");
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const tx = paymentsData.find((t) => t.id === txCode);

    if (!tx) {
      return interaction.reply({
        content: "Giao dịch không tồn tại!",
        ephemeral: true,
      });
    }

    const isAdmin = interaction.member.permissions.has("Administrator");
    if (!isAdmin && tx.sellerId !== userId) {
      return interaction.reply({
        content: "Bạn chỉ có thể cancel TX của mình (là seller)!",
        ephemeral: true,
      });
    }

    if (tx.status !== "pending") {
      return interaction.reply({
        content: "Giao dịch đã xử lý rồi!",
        ephemeral: true,
      });
    }

    tx.status = "cancelled";
    tx.processedDate = new Date().toISOString();
    tx.reason = reason;
    await savePaymentsData();

    const embed = new EmbedBuilder()
      .setTitle("❌ Giao dịch hủy")
      .addFields(
        { name: "Mã TX", value: tx.id, inline: true },
        {
          name: "Số tiền",
          value: `${tx.amount.toLocaleString()} VNĐ`,
          inline: true,
        },
        { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true }, // Fix: Dùng tx.buyerId
        { name: "Seller", value: `<@${tx.sellerId}>`, inline: true }, // Fix: Dùng tx.sellerId
        { name: "Lý do", value: reason }
      )
      .setColor("Red")
      .setTimestamp();

    await logMessage(
      `[payment-cancel] User ${userTag} (${userId}) hủy TX ${txCode} (Seller: ${tx.sellerId}, Buyer: ${tx.buyerId}): ${reason}`
    );
    await interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
