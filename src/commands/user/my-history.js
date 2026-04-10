const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const {
  attachPaginationCollector,
  createPaginationRow,
} = require("../../utils/paginationUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Xem lịch sử thanh toán cá nhân của bạn'),

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const userId = interaction.user.id;
    const sortedPayments = paymentService.getSortedPayments();
    const userTxs = sortedPayments.filter((t) => t.buyerId === userId && t.status === 'confirmed');

    const totalAmount = userTxs.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const txCount = userTxs.length;

    if (txCount === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Lịch sử của bạn')
        .setDescription('Bạn chưa có giao dịch confirmed nào!')
        .setColor('Grey')
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    const buyerTotals = {};
    sortedPayments
      .filter((t) => t.status === 'confirmed')
      .forEach((tx) => {
        buyerTotals[tx.buyerId] = (buyerTotals[tx.buyerId] || 0) + (tx.amount || 0);
      });

    const sortedBuyers = Object.entries(buyerTotals).sort(([, a], [, b]) => b - a);
    const rank = sortedBuyers.findIndex(([id]) => id === userId) + 1;

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
            `- ${tx.id} - ${tx.amount.toLocaleString('vi-VN', {
              style: 'currency',
              currency: 'VND',
            })} - ${new Date(tx.date).toLocaleDateString('vi-VN')}`,
        )
        .join('\n');

      return new EmbedBuilder()
        .setTitle('Lịch sử thanh toán của bạn')
        .addFields(
          {
            name: 'Tổng tiền',
            value: `${totalAmount.toLocaleString('vi-VN', {
              style: 'currency',
              currency: 'VND',
            })}`,
            inline: true,
          },
          { name: 'Số TX', value: txCount.toString(), inline: true },
          {
            name: 'Rank của bạn',
            value: rank > 0 ? `#${rank}` : 'Chưa rank',
            inline: true,
          },
          { name: 'Chi tiết', value: list || 'N/A' },
        )
        .setColor('Blue')
        .setTimestamp()
        .setFooter({ text: `Trang ${pg + 1}/${totalPages}` });
    };

    const prevCustomId = `prev_hist_${interaction.id}`;
    const nextCustomId = `next_hist_${interaction.id}`;

    const createButtons = (pg) =>
      createPaginationRow({
        prevCustomId,
        nextCustomId,
        page: pg,
        totalPages,
      });

    const components = totalPages > 1 ? [createButtons(page)] : [];

    const replyMessage = await interaction.editReply({
      embeds: [createEmbed(page)],
      components,
      fetchReply: true,
    });

    if (totalPages > 1) {
      attachPaginationCollector({
        message: replyMessage,
        interaction,
        prevCustomId,
        nextCustomId,
        time: 300000,
        onPage: async (i) => {
          if (i.customId === prevCustomId && page > 0) {
            page -= 1;
          }
          if (i.customId === nextCustomId && page < totalPages - 1) {
            page += 1;
          }

          await i.editReply({
            embeds: [createEmbed(page)],
            components: [createButtons(page)],
          });
        },
        onEnd: async () => {
          await interaction.editReply({ components: [] }).catch(() => {});
        },
      });
    }

    await logger.info(
      `[history] User ${interaction.user.tag} xem lịch sử: ${txCount} TX, ${totalAmount.toLocaleString(
        'vi-VN',
        {
          style: 'currency',
          currency: 'VND',
        },
      )}, rank ${rank > 0 ? rank : 'N/A'}`,
      SHEETS_ID,
    );
  },
};
