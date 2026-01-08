const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setqr")
    .setDescription("Thiết lập/cập nhật QR code thanh toán (admin only)")
    .addStringOption((option) =>
      option
        .setName("bank_name")
        .setDescription("Tên chủ TK/ngân hàng")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("account_number")
        .setDescription("Số tài khoản")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("url").setDescription("URL/text cho QR").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("logo_url")
        .setDescription("URL logo thumbnail (optional)")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User để set QR (default: bạn)")
        .setRequired(false)
    ),
  adminOnly: true,
  async execute(interaction, config) {
    const {
      qrDataService,
      logger,
      QRCode,
      AttachmentBuilder,
      createQrEmbed,
      createEditButtons,
      SHEETS_ID,
    } = config;


    const targetUser = interaction.options.getUser("user") || interaction.user;
    const userId = targetUser.id;
    const userTag = targetUser.tag;
    const bank = interaction.options.getString("bank_name");
    const account = interaction.options.getString("account_number");
    const url = interaction.options.getString("url");
    const logo = interaction.options.getString("logo_url") || null;

    if (url.length > 500) {
      return interaction.editReply({
        content: "URL quá dài! Giữ dưới 500 ký tự để QR gen tốt.",
        ephemeral: true,
      });
    }

    try {
      new URL(url.startsWith("http") ? url : "http://" + url);
    } catch {
      return interaction.editReply({
        content: "URL không hợp lệ! Phải là URL hoặc text đơn giản.",
        ephemeral: true,
      });
    }

    await logger.info(
      `[setqr] Admin ${
        interaction.user.tag
      } set for ${userTag} (${userId}): bank=${bank}, account=${account}, url=${url}, logo=${
        logo || "none"
      }`,
      SHEETS_ID
    );

    try {
      const qrBuffer = await QRCode.toBuffer(url, {
        width: 256,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const attachment = new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });

      qrDataService.setQr(userId, { bank, account, url, logo });
      await qrDataService.saveQrDataToSheet(SHEETS_ID); // ← Sửa chỗ này

      const embed = createQrEmbed(qrDataService.getQr(userId), attachment);
      const components = [createEditButtons(userId)];

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        components,
        ephemeral: false,
      });

      await logger.info(
        `[setqr] Thành công cho ${userTag} bởi admin ${interaction.user.tag}`,
        SHEETS_ID
      );
    } catch (error) {
      await logger.error(
        `[setqr] Lỗi QR cho ${userTag}: ${error.message}`,
        SHEETS_ID
      );
      await interaction.editReply({
        content: `Lỗi tạo QR từ "${url}"!`,
        ephemeral: true,
      });
    }
  },
};
