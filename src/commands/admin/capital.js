const {
  SlashCommandBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const path = require('path');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('capital')
    .setDescription('Quan ly von va xem loi nhuan (admin only)')
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('Hanh dong: them von hoac xem loi nhuan')
        .setRequired(true)
        .addChoices({ name: 'Them von', value: 'add' }, { name: 'Xem loi nhuan', value: 'show' }),
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
          content: `Khong the dong bo du lieu moi nhat: ${syncError.message}`,
        });
      }

      const currentCapital = getCapitalData();
      const totalConfirmed = paymentService.getTotalConfirmed();
      const profit = totalConfirmed - currentCapital;

      const embed = new EmbedBuilder()
        .setTitle('Bao cao tai chinh')
        .addFields(
          {
            name: 'Tien von hien tai',
            value: `${currentCapital.toLocaleString()} VND`,
            inline: true,
          },
          {
            name: 'Tong tien confirmed',
            value: `${totalConfirmed.toLocaleString()} VND`,
            inline: true,
          },
          {
            name: 'Loi nhuan',
            value: `${profit.toLocaleString()} VND`,
            inline: true,
          },
        )
        .setColor(profit >= 0 ? 'Green' : 'Red')
        .setTimestamp();

      await logger.info(
        `[capital] Admin ${interaction.user.tag} xem loi nhuan: ${profit.toLocaleString()} VND`,
        SHEETS_ID,
      );

      return interaction.editReply({ embeds: [embed], ephemeral: false });
    }

    if (action === 'add') {
      const modal = new ModalBuilder()
        .setCustomId(`capital_modal_${interaction.user.id}`)
        .setTitle('Them tien von');

      const input = new TextInputBuilder()
        .setCustomId('capital_amount')
        .setLabel('So tien them (VND)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Vi du: 500000')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      await interaction.showModal(modal);
    }
  },
};
