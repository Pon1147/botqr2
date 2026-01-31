const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Xem lịch sử thanh toán cá nhân của bạn 💳"),
  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const userId = interaction.user.id;
    const sortedPayments = paymentService.getSortedPayments();
    const userTxs = sortedPayments.filter(
      (t) => t.buyerId === userId && t.status === "confirmed"
    );
    const totalAmount = userTxs.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const txCount = userTxs.length;

    if (txCount === 0) {
      const embed = new EmbedBuilder()
        .setTitle("📋 Lịch sử của bạn")
        .setDescription(
          "Bạn chưa có giao dịch confirmed nào! Bắt đầu bằng /pay nhé 😊"
        )
        .setColor("Grey")
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // Tính rank từ toàn bộ confirmed TX
    const buyerTotals = {};
    sortedPayments
      .filter((t) => t.status === "confirmed")
      .forEach((tx) => {
        buyerTotals[tx.buyerId] =
          (buyerTotals[tx.buyerId] || 0) + (tx.amount || 0);
      });

    const sortedBuyers = Object.entries(buyerTotals).sort(
      ([, a], [, b]) => b - a
    );
    const rank = sortedBuyers.findIndex(([id]) => id === userId) + 1;

    // Pagination nếu >5 TX
    const perPage = 5;
    let page = 0;
    const totalPages = Math.ceil(txCount / perPage);

    const createEmbed = (pg) => {
      const start = pg * perPage;
      const pageTxs = userTxs
        .slice(start, start + perPage)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      const list = pageTxs
        .map(
          (tx) =>
            `✅ ${tx.id} - ${tx.amount.toLocaleString("vi-VN", {
              style: "currency",
              currency: "VND",
            })} - ${new Date(tx.date).toLocaleDateString("vi-VN")}`
        )
        .join("\n");

      return new EmbedBuilder()
        .setTitle("📋 Lịch sử thanh toán của bạn")
        .addFields(
          {
            name: "💰 Tổng tiền",
            value: `${totalAmount.toLocaleString("vi-VN", {
              style: "currency",
              currency: "VND",
            })}`,
            inline: true,
          },
          { name: "📊 Số TX", value: txCount.toString(), inline: true },
          {
            name: "🏆 Rank của bạn",
            value: rank > 0 ? `#${rank}` : "Chưa rank",
            inline: true,
          },
          { name: "Chi tiết", value: list || "N/A" }
        )
        .setColor("Blue")
        .setTimestamp()
        .setFooter({ text: `Trang ${pg + 1}/${totalPages}` });
    };

    const embed = createEmbed(page);
    let components = [];
    if (totalPages > 1) {
      components = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prev_hist_${userId}_${page}`)
            .setLabel("Trước")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`next_hist_${userId}_${page}`)
            .setLabel("Sau")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1)
        ),
      ];
    }

    await interaction.editReply({ embeds: [embed], components });

    if (totalPages > 1) {
      const collector = interaction.createMessageComponentCollector({
        filter: (i) =>
          i.user.id === userId &&
          (i.customId.startsWith("prev_hist_") ||
            i.customId.startsWith("next_hist_")),
        time: 300000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();

        const parts = i.customId.split("_");
        const action = parts[0];
        let newPage = page;
        if (action === "prev_hist" && newPage > 0) newPage--;
        if (action === "next_hist" && newPage < totalPages - 1) newPage++;

        page = newPage;

        const newEmbed = createEmbed(page);
        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prev_hist_${userId}_${page}`)
            .setLabel("Trước")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`next_hist_${userId}_${page}`)
            .setLabel("Sau")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1)
        );

        await i.editReply({ embeds: [newEmbed], components: [newRow] });
      });

      collector.on("end", async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }

    await logger.info(
      `[history] User ${
        interaction.user.tag
      } xem lịch sử: ${txCount} TX, ${totalAmount.toLocaleString("vi-VN", {
        style: "currency",
        currency: "VND",
      })}, rank ${rank > 0 ? rank : "N/A"}`,
      SHEETS_ID
    );
  },
};
