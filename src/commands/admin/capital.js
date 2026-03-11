const {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('capital')
    .setDescription('Quản lý vốn và xem lợi nhuận (admin only)')
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('Hành động: thêm vốn hoặc xem lợi nhuận')
        .setRequired(true)
        .addChoices({ name: 'Thêm vốn', value: 'add' }, { name: 'Xem lợi nhuận', value: 'show' }),
    ),
  adminOnly: true,
  ephemeral: false,
  autoDefer: false,

  async execute(interaction, config) {
    const { paymentService, logger, getCapitalData, loadCapitalFromSheet, SHEETS_ID } = config;

    const action = interaction.options.getString('action');

    if (action === 'show') {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: false });
      }

      try {
        await Promise.all([
          loadCapitalFromSheet(config),
          paymentService.loadPaymentsFromSheet(SHEETS_ID),
        ]);
      } catch (syncError) {
        return interaction.editReply({
          content: `Không thể đồng bộ dữ liệu mới nhất: ${syncError.message}`,
        });
      }

      const currentCapital = getCapitalData();
      const totalConfirmed = paymentService.getTotalConfirmed();
      const profit = totalConfirmed - currentCapital;

      const embed = new EmbedBuilder()
        .setTitle('Báo cáo tài chính')
        .addFields(
          {
            name: 'Tiền vốn hiện tại',
            value: `${currentCapital.toLocaleString()} VND`,
            inline: true,
          },
          {
            name: 'Tổng tiền confirmed',
            value: `${totalConfirmed.toLocaleString()} VND`,
            inline: true,
          },
          {
            name: 'Lợi nhuận',
            value: `${profit.toLocaleString()} VND`,
            inline: true,
          },
        )
        .setColor(profit >= 0 ? 'Green' : 'Red')
        .setTimestamp();

      await logger.info(
        `[capital] Admin ${interaction.user.tag} xem lợi nhuận: ${profit.toLocaleString()} VND`,
        SHEETS_ID,
      );

      return interaction.editReply({ embeds: [embed], ephemeral: false });
    }

    if (action === 'add') {
      const modal = new ModalBuilder()
        .setCustomId(`capital_modal_${interaction.user.id}`)
        .setTitle('Thêm tiền vốn');

      const input = new TextInputBuilder()
        .setCustomId('capital_amount')
        .setLabel('Số tiền thêm (VND)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ví dụ: 500000')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      await interaction.showModal(modal);
    }
  },
};
