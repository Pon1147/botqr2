const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("list-payments")
    .setDescription("Liệt kê tất cả giao dịch (admin only)")
    .addStringOption((option) =>
      option
        .setName("status")
        .setDescription("Lọc trạng thái: pending, confirmed, cancelled")
        .setRequired(false)
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
    getSortedPayments // Added for sorted view
  ) {
    await interaction.deferReply();

    const statusFilter = interaction.options.getString("status");
    const sortedPayments = getSortedPayments();
    const filteredTxs = statusFilter
      ? sortedPayments.filter((t) => t.status === statusFilter)
      : sortedPayments;

    if (filteredTxs.length === 0) {
      return interaction.editReply({
        content: "Không có giao dịch nào!",
        ephemeral: false,
      });
    }

    const recentTxs = filteredTxs.slice(0, 10); // Limit 10 recent
    const sellerTag = process.env.DEFAULT_SELLER_TAG || "Seller Fixed";
    const list = recentTxs
      .map(
        (tx) =>
          `${
            tx.status === "confirmed"
              ? "✅"
              : tx.status === "cancelled"
              ? "❌"
              : "⏳"
          } ${tx.id} - ${tx.amount.toLocaleString()} VNĐ (<@${
            tx.buyerId
          }> -> ${sellerTag}) - ${new Date(tx.date).toLocaleDateString(
            "vi-VN"
          )}`
      )
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(
        `📋 Danh sách giao dịch ${statusFilter ? `(${statusFilter})` : ""}`
      )
      .addFields(
        { name: "Tổng số", value: filteredTxs.length.toString(), inline: true },
        { name: "Gần nhất (top 10)", value: list || "N/A" }
      )
      .setColor("Blue")
      .setTimestamp();

    await logMessage(
      "INFO",
      `[list-payments] Admin ${interaction.user.tag} xem ${
        filteredTxs.length
      } tx${statusFilter ? ` (${statusFilter})` : ""}`
    );
    await interaction.editReply({ embeds: [embed], ephemeral: false });
  },
};
