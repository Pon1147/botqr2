const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const {
  buildVietQrImageUrl,
  fetchImageBuffer,
  generateVietQrBuffer,
} = require("../../utils/vietqrUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setqr")
    .setDescription("Thiết lập/cập nhật QR code thanh toán (admin only)")
    .addStringOption((option) =>
      option
        .setName("bank_name")
        .setDescription("Tên chủ TK/ngân hàng")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("account_number")
        .setDescription("Số tài khoản")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("bank_code")
        .setDescription("Mã ngân hàng VietQR, ví dụ 970422")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("account_name")
        .setDescription("Tên chủ tài khoản dùng cho VietQR")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("qr_content")
        .setDescription("Nội dung QR fallback (text hoặc link)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("url")
        .setDescription("[Legacy] Nội dung QR fallback")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("logo_url")
        .setDescription("URL logo thumbnail (optional)")
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User để set QR (default: bạn)")
        .setRequired(false),
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
    const bankCode = interaction.options.getString("bank_code") || "";
    const accountName =
      interaction.options.getString("account_name") || bank || "";
    const qrContent =
      interaction.options.getString("qr_content") ||
      interaction.options.getString("url") ||
      "";
    const logo = interaction.options.getString("logo_url") || null;

    if (!qrContent && !bankCode) {
      return interaction.editReply({
        content:
          "Hãy nhập nội dung QR fallback hoặc cấu hình bank_code để tạo VietQR.",
        ephemeral: true,
      });
    }

    if (qrContent.length > 500) {
      return interaction.editReply({
        content: "Nội dung QR quá dài! Giữ dưới 500 ký tự để QR gen tốt.",
        ephemeral: true,
      });
    }

    await logger.info(
      `[setqr] Admin ${interaction.user.tag} set for ${userTag} (${userId}): bank=${bank}, account=${account}, bankCode=${bankCode || "none"}, accountName=${accountName || "none"}, qrContent=${qrContent || "none"}, logo=${logo || "none"}`,
      SHEETS_ID,
    );

    try {
      let attachment;
      let qrBuffer;

      if (bankCode) {
        try {
          qrBuffer = await generateVietQrBuffer({
            bankCode,
            accountNumber: account,
            accountName,
            amount: 0,
            addInfo: qrContent || bank,
          });
        } catch (generateError) {
          await logger.warn(
            `[setqr] VietQR API generate fail for ${userTag}, fallback to image URL: ${generateError.message}`,
            SHEETS_ID,
          );

          const vietQrImageUrl = buildVietQrImageUrl({
            bankCode,
            accountNumber: account,
            accountName,
            amount: 0,
            addInfo: qrContent || bank,
          });

          if (vietQrImageUrl) {
            qrBuffer = await fetchImageBuffer(vietQrImageUrl);
          }
        }
      }

      if (!qrBuffer) {
        const fallbackQrContent = qrContent || `${bank} ${account}`.trim();
        qrBuffer = await QRCode.toBuffer(fallbackQrContent, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });
      }

      attachment = new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });

      qrDataService.setQr(userId, {
        bank,
        account,
        url: qrContent,
        qrContent,
        logo,
        bankCode,
        accountName,
      });
      await qrDataService.saveQrDataToSheet(SHEETS_ID);

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
        SHEETS_ID,
      );
    } catch (error) {
      await logger.error(`[setqr] Lỗi QR cho ${userTag}: ${error.message}`, SHEETS_ID);
      await interaction.editReply({
        content: `Lỗi tạo QR từ "${qrContent || bankCode}"!`,
        ephemeral: true,
      });
    }
  },
};
