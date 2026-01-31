const { SlashCommandBuilder } = require("discord.js");
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("removeqr")
    .setDescription("Xóa QR code đã thiết lập (admin only)")
    .addUserOption((option) =>
      option.setName("user").setDescription("User để xóa QR").setRequired(true)
    ),
  adminOnly: true,

  async execute(interaction, config) {
    const { qrDataService, logger, SHEETS_ID } = config;


    const targetUser = interaction.options.getUser("user");
    const userId = targetUser.id;
    const userTag = targetUser.tag;

    if (!qrDataService.getQr(userId)) {
      return interaction.editReply({
        content: "User này chưa có QR!",
        ephemeral: true,
      });
    }

    qrDataService.deleteQr(userId);
    await qrDataService.saveQrDataToSheet(SHEETS_ID);

    await logger.info(
      `[removeqr] Admin ${interaction.user.tag} xóa QR của ${userTag} (${userId})`,
      SHEETS_ID
    );

    await interaction.editReply({
      content: `Đã xóa QR của ${targetUser}!`,
      ephemeral: false,
    });
  },
};
