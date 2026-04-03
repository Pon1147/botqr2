const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

function buildRatingButtons(txId, buyerId) {
  const row = new ActionRowBuilder();

  for (let rating = 1; rating <= 5; rating += 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`feedback_rate_${rating}_${txId}_${buyerId}`)
        .setLabel(`${rating} ★`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Xác nhận thanh toán thành công (chỉ admin)')
    .addStringOption((option) =>
      option.setName('transaction_code').setDescription('Mã giao dịch').setRequired(true),
    ),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const txCode = interaction.options.getString('transaction_code').toUpperCase();

    const tx = paymentService.getSortedPayments().find((t) => t.id === txCode);

    if (!tx || tx.status !== 'pending') {
      return interaction.editReply({
        content: 'Giao dịch không tồn tại hoặc đã xử lý!',
        ephemeral: true,
      });
    }

    tx.status = 'confirmed';
    tx.processedDate = new Date().toISOString();

    await paymentService.savePaymentsToSheet(SHEETS_ID);

    let sellerTag = 'Seller Fixed';
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag;
      } catch (error) {
        await logger.error(
          `Lỗi lấy seller info khi confirm TX ${txCode}: ${error.message}`,
          SHEETS_ID,
        );
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Thanh toán xác nhận')
      .addFields(
        { name: 'Mã TX', value: tx.id, inline: true },
        {
          name: 'Số tiền',
          value: `${tx.amount.toLocaleString()} VNĐ`,
          inline: true,
        },
        { name: 'Người mua', value: `<@${tx.buyerId}>`, inline: true },
        { name: 'Người bán', value: sellerTag, inline: true },
        { name: 'Mô tả', value: tx.description || 'N/A' },
        {
          name: 'Ngày xử lý',
          value: new Date(tx.processedDate).toLocaleDateString('vi-VN'),
          inline: true,
        },
        {
          name: 'Đánh giá quy trình mua hàng',
          value: 'Người mua vui lòng bấm sao bên dưới để gửi feedback.',
          inline: false,
        },
      )
      .setColor('Green')
      .setTimestamp();

    await logger.info(
      `[confirm] Admin ${interaction.user.tag} xác nhận TX ${txCode} (Buyer: ${tx.buyerId})`,
      SHEETS_ID,
    );

    await interaction.editReply({
      embeds: [embed],
      components: [buildRatingButtons(tx.id, tx.buyerId)],
      content: `<@${tx.buyerId}> Thanh toán đã xác nhận!`,
      ephemeral: false,
    });
  },
};
