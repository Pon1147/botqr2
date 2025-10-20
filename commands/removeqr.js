// commands/removeqr.js - Admin Command
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("removeqr")
    .setDescription("Xóa QR code đã thiết lập")
    .addUserOption((option) =>
      option.setName("user").setDescription("User để xóa QR").setRequired(true)
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
    createEditButtons
  ) {
    const targetUser = interaction.options.getUser("user");
    const userId = targetUser.id;
    const userTag = targetUser.tag;

    if (!userQrData.has(userId)) {
      return interaction.reply({
        content: "User này chưa có QR!",
        ephemeral: true,
      });
    }

    userQrData.delete(userId);
    await saveQrData();

    await logMessage(
      `[removeqr] Admin ${interaction.user.tag} xóa QR của ${userTag} (${userId})`
    );
    await interaction.reply({
      content: `Đã xóa QR của ${targetUser}!`,
      ephemeral: true,
    });
  },
};
