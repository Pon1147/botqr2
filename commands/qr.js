// commands/qr.js - User Command
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("qr")
    .setDescription("Hiển thị QR code để quét thanh toán"),
  adminOnly: false,
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
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const qrObj = userQrData.get(userId);

    if (!qrObj) {
      await logMessage(`[qr] User ${userTag} (${userId}) chưa set QR`);
      return interaction.reply({
        content: "Chưa set QR! Dùng /setqr trước.",
        ephemeral: true,
      });
    }
    await logMessage(`[qr] User ${userTag} (${userId}) xem QR`);

    try {
      const qrBuffer = await QRCode.toBuffer(qrObj.url, {
        width: 256,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const attachment = new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });
      const embed = createQrEmbed(qrObj, attachment);

      await interaction.reply({
        embeds: [embed],
        files: [attachment],
        ephemeral: false,
      });
      await logMessage(`[qr] Thành công cho ${userTag}`);
    } catch (error) {
      await logMessage(`[qr] Lỗi tạo QR cho ${userTag}: ${error.message}`);
      await interaction.reply({
        content: `Lỗi tạo QR từ "${qrObj.url}"!`,
        ephemeral: true,
      });
    }
  },
};
