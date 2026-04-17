const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");
const {
  buildPaymentActionRow,
  buildPendingPaymentContent,
  buildPendingPaymentEmbed,
} = require("../../flows/paymentFlow");
const {
  buildVietQrImageUrl,
  fetchImageBuffer,
  generateVietQrBuffer,
} = require("../../utils/vietqrUtils");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Tạo yêu cầu thanh toán + show QR (admin only)")
    .addUserOption((option) =>
      option
        .setName("buyer")
        .setDescription("Người trả tiền (buyer)")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Số tiền (VNĐ)")
        .setRequired(true)
        .setMinValue(10000)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Mô tả giao dịch")
        .setRequired(true)
    ),

  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const {
      qrDataService,
      paymentService,
      logger,
      AttachmentBuilder,
      SHEETS_ID,
    } = config;

    const buyer = interaction.options.getUser("buyer");
    const amount = interaction.options.getInteger("amount");
    const description = interaction.options.getString("description");
    const buyerId = buyer.id;
    const buyerTag = buyer.tag;

    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (!sellerId) {
      return interaction.editReply({
        content: "Chưa set DEFAULT_SELLER_ID trong .env!",
        ephemeral: true,
      });
    }

    const seller = await interaction.guild.members
      .fetch(sellerId)
      .catch(() => null);
    if (!seller) {
      return interaction.editReply({
        content: `Seller ID ${sellerId} không tồn tại trong guild!`,
        ephemeral: true,
      });
    }
    const sellerTag = seller.user.tag;

    if (buyerId === sellerId) {
      return interaction.editReply({
        content: "Buyer không được là seller!",
        ephemeral: true,
      });
    }

    const qrObj = qrDataService.getQr(sellerId);
    if (!qrObj) {
      return interaction.editReply({
        content: `Seller chưa set QR! Dùng /qr trước cho <@${sellerId}>.`,
        ephemeral: true,
      });
    }

    if (!qrObj.bankCode || !qrObj.account) {
      return interaction.editReply({
        content:
          `Seller chưa cấu hình bank_code/account_number đầy đủ để tạo QR tự điền số tiền và nội dung. Hãy chạy /qr và nhập bank_code + account_number cho <@${sellerId}>.`,
        ephemeral: true,
      });
    }

    // Gen unique txId
    let txId;
    do {
      txId = `TX${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    } while (paymentService.getSortedPayments().some((tx) => tx.id === txId));

    const newTx = {
      id: txId,
      buyerId,
      amount,
      description,
      status: "pending",
      date: new Date().toISOString(),
      sellerId,
      sellerTag,
    };

    await paymentService.addPayment(newTx, SHEETS_ID); // Append row mới, cache in-memory vẫn cập nhật ngay

    try {
      let attachment;
      let qrBuffer;

      try {
        qrBuffer = await generateVietQrBuffer({
          bankCode: qrObj.bankCode,
          accountNumber: qrObj.account,
          accountName: qrObj.accountName || qrObj.bank,
          amount,
          addInfo: txId,
        });
      } catch (generateError) {
        await logger.warn(
          `[pay] VietQR API generate fail for TX ${txId}, fallback to image URL: ${generateError.message}`,
          SHEETS_ID,
        );

        const vietQrImageUrl = buildVietQrImageUrl({
          bankCode: qrObj.bankCode,
          accountNumber: qrObj.account,
          accountName: qrObj.accountName || qrObj.bank,
          amount,
          addInfo: txId,
        });

        if (!vietQrImageUrl) {
          throw generateError;
        }

        qrBuffer = await fetchImageBuffer(vietQrImageUrl);
      }

      attachment = new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });

      const embed = buildPendingPaymentEmbed({
        txId,
        amount,
        buyerId,
        sellerId,
        sellerTag,
        description,
        qrObj,
      });

      await logger.info(
        `[pay] Admin ${interaction.user.tag} tạo TX ${txId}: Buyer ${buyerTag} (${buyerId}) -> Seller ${sellerTag} (${sellerId}): ${amount} VNĐ - ${description}`,
        SHEETS_ID
      );

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        components: [buildPaymentActionRow(txId, buyerId)],
        content: buildPendingPaymentContent({ buyerId, sellerId }),
        fetchReply: true,
      });
    } catch (error) {
      await logger.error(
        `[pay] Lỗi gen QR cho TX ${txId}: ${error.message}`,
        SHEETS_ID
      );

      const fallbackEmbed = new EmbedBuilder()
        .setTitle("💳 Yêu cầu thanh toán")
        .addFields(
          {
            name: "⚠️ CẢNH BÁO",
            value:
              "**CẤM GHI MUA/BÁN VÀ CHỈNH SỬA NỘI DUNG - CỐ Ý GHI PHẠT 10%**",
            inline: false,
          },
          { name: "Mã TX", value: txId, inline: true },
          {
            name: "Số tiền",
            value: `${amount.toLocaleString()} VNĐ`,
            inline: true,
          },
          { name: "Buyer", value: `<@${buyerId}>`, inline: true },
          { name: "Seller", value: `<@${sellerId}>`, inline: true },
          { name: "Mô tả", value: description },
          { name: "Trạng thái", value: "⏳ Chờ xác nhận" },
          {
            name: "Lỗi QR",
            value: `Liên hệ admin để lấy QR thủ công: ${qrObj.url}`,
          }
        )
        .setColor("Blue")
        .setTimestamp();

      await interaction.editReply({
        embeds: [fallbackEmbed],
        components: [buildPaymentActionRow(txId, buyerId)],
        content: buildPendingPaymentContent({ buyerId, sellerId }),
        fetchReply: true,
      });
    }
  },
};
