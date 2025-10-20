// commands/payment-confirm.js - Public Command
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-confirm")
    .setDescription("Xác nhận thanh toán thành công (cho TX của bạn)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch")
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
    const txCode = interaction.options
      .getString("transaction_code")
      .toUpperCase();
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
        content: "Bạn chỉ có thể confirm TX của mình (là seller)!",
        ephemeral: true,
      });
    }

    if (tx.status !== "pending") {
      return interaction.reply({
        content: "Giao dịch đã xử lý rồi!",
        ephemeral: true,
      });
    }

    tx.status = "confirmed";
    tx.processedDate = new Date().toISOString();
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
        { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true }, // Fix: Dùng tx.buyerId
        { name: "Seller", value: `<@${tx.sellerId}>`, inline: true }, // Fix: Dùng tx.sellerId
        { name: "Mô tả", value: tx.description }
      )
      .setColor("Green")
      .setTimestamp();

    await logMessage(
      `[payment-confirm] User ${userTag} (${userId}) xác nhận TX ${txCode} (Seller: ${tx.sellerId}, Buyer: ${tx.buyerId})`
    );
    await interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
