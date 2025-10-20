const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("qr")
    .setDescription("Hiển thị QR code (admin only)")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User để show QR")
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
    createEditButtons
  ) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const userId = targetUser.id;
    const userTag = targetUser.tag;
    const qrObj = userQrData.get(userId);

    if (!qrObj) {
      await logMessage(
        `[qr] Admin ${interaction.user.tag} xem QR của ${userTag} (${userId}) - chưa set`
      );
      return interaction.editReply({
        content: "User chưa set QR! Dùng /setqr trước.",
        ephemeral: true,
      });
    }
    await logMessage(
      `[qr] Admin ${interaction.user.tag} xem QR của ${userTag} (${userId})`
    );

    try {
      const qrBuffer = await QRCode.toBuffer(qrObj.url, {
        width: 256,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const attachment = new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
      const embed = createQrEmbed(qrObj, attachment);

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        ephemeral: false,
      });
      await logMessage(
        `[qr] Thành công cho ${userTag} bởi admin ${interaction.user.tag}`
      );
    } catch (error) {
      await logMessage(`[qr] Lỗi tạo QR cho ${userTag}: ${error.message}`);
      await interaction.editReply({
        content: `Lỗi tạo QR từ "${qrObj.url}"!`,
        ephemeral: true,
      });
    }
  },
};
