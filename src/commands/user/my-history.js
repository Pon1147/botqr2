const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Xem lich su thanh toan ca nhan cua ban'),

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const userId = interaction.user.id;
    const sortedPayments = paymentService.getSortedPayments();
    const userTxs = sortedPayments.filter((t) => t.buyerId === userId && t.status === 'confirmed');

    const totalAmount = userTxs.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const txCount = userTxs.length;

    if (txCount === 0) {
      const embed = new EmbedBuilder()
        .setTitle('Lich su cua ban')
        .setDescription('Ban chua co giao dich confirmed nao!')
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
        .setTitle('Lich su thanh toan cua ban')
        .addFields(
          {
            name: 'Tong tien',
            value: `${totalAmount.toLocaleString('vi-VN', {
              style: 'currency',
              currency: 'VND',
            })}`,
            inline: true,
          },
          { name: 'So TX', value: txCount.toString(), inline: true },
          {
            name: 'Rank cua ban',
            value: rank > 0 ? `#${rank}` : 'Chua rank',
            inline: true,
          },
          { name: 'Chi tiet', value: list || 'N/A' },
        )
        .setColor('Blue')
        .setTimestamp()
        .setFooter({ text: `Trang ${pg + 1}/${totalPages}` });
    };

    const createButtons = (pg) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`prev_hist_${interaction.id}`)
          .setLabel('Truoc')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pg === 0),
        new ButtonBuilder()
          .setCustomId(`next_hist_${interaction.id}`)
          .setLabel('Sau')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pg === totalPages - 1),
      );

    const components = totalPages > 1 ? [createButtons(page)] : [];

    const replyMessage = await interaction.editReply({
      embeds: [createEmbed(page)],
      components,
      fetchReply: true,
    });

    if (totalPages > 1) {
      const collector = replyMessage.createMessageComponentCollector({
        filter: (i) =>
          i.user.id === userId &&
          (i.customId === `prev_hist_${interaction.id}` ||
            i.customId === `next_hist_${interaction.id}`),
        time: 300000,
      });

      collector.on('collect', async (i) => {
        await i.deferUpdate();

        if (i.customId === `prev_hist_${interaction.id}` && page > 0) {
          page -= 1;
        }
        if (i.customId === `next_hist_${interaction.id}` && page < totalPages - 1) {
          page += 1;
        }

        await i.editReply({
          embeds: [createEmbed(page)],
          components: [createButtons(page)],
        });
      });

      collector.on('end', async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }

    await logger.info(
      `[history] User ${interaction.user.tag} xem lich su: ${txCount} TX, ${totalAmount.toLocaleString(
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
