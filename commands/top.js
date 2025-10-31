const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Xem top 10 buyer theo tổng amount confirmed 💰"),
  async execute(
    interaction,
    userQrData,
    paymentsData,
    saveQrDataToSheet,
    savePaymentsToSheet,
    logMessage,
    QRCode,
    AttachmentBuilder,
    createQrEmbed,
    createEditButtons,
    getSortedPayments,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    capitalData
  ) {
    try {
      await interaction.deferReply();

      // Filter chỉ confirmed payments
      const confirmedPayments = paymentsData.filter(
        (tx) => tx.status === "confirmed" && tx.amount > 0
      );

      if (confirmedPayments.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xffc0cb)
          .setTitle("🏆 TOP BUYER")
          .setDescription("Chưa có payment confirmed nào để rank top! 😅")
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Aggregate: sum amount per buyerId
      const buyerTotals = {};
      confirmedPayments.forEach((tx) => {
        const buyerId = tx.buyerId;
        const amt = tx.amount || 0;
        buyerTotals[buyerId] = (buyerTotals[buyerId] || 0) + amt;
      });

      // Sort all desc by total để tính rank
      const sortedBuyers = Object.entries(buyerTotals).sort(
        ([, a], [, b]) => b - a
      );

      // Tìm rank của user hiện tại
      const currentUserId = interaction.user.id;
      const currentUserTotal = buyerTotals[currentUserId] || 0;
      const currentRank =
        sortedBuyers.findIndex(([id]) => id === currentUserId) + 1;
      let trackingMsg = "";
      if (currentUserTotal > 0 && currentRank > 10) {
        trackingMsg = `Bạn đang ở top ${currentRank} với ${currentUserTotal.toLocaleString(
          "vi-VN"
        )} VNĐ 💪`;
      }

      // Top 10 với username fetch
      const TOP_LIMIT = 10;
      const topBuyerPromises = sortedBuyers
        .slice(0, TOP_LIMIT)
        .map(async ([buyerId, total]) => {
          try {
            const user = await interaction.client.users.fetch(buyerId);
            const username = user.username || user.globalName || "Unknown User";
            return `${
              sortedBuyers.findIndex(([id]) => id === buyerId) + 1
            }. **${username}** - ${total.toLocaleString("vi-VN")} VNĐ`;
          } catch (fetchError) {
            return `${
              sortedBuyers.findIndex(([id]) => id === buyerId) + 1
            }. **Unknown User** - ${total.toLocaleString("vi-VN")} VNĐ`;
          }
        });

      const topBuyers = await Promise.all(topBuyerPromises);

      const embed = new EmbedBuilder()
        .setColor(0xffc0cb)
        .setTitle(`🏆 TOP ${TOP_LIMIT} BUYER đã góp gạo nuôi Yên`)
        .setDescription(topBuyers.join("\n"))
        .setTimestamp()
        .setFooter({ text: trackingMsg || "Cập nhật từ Payments sheet" });

      await interaction.editReply({ embeds: [embed] });
      await logMessage(
        "INFO",
        `User ${currentUserId} gọi /top: ${
          topBuyers.length
        } top buyers, rank của bạn: ${currentRank > 0 ? currentRank : "N/A"}`
      );
    } catch (error) {
      await logMessage("ERROR", `Lỗi /top: ${error.message}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("❌ Lỗi")
        .setDescription("Không load được top buyer, thử lại sau nhé!");
      if (!interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      }
    }
  },
};
