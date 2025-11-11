const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { v4: uuidv4 } = require("uuid");

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
        .setMinValue(1000)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Mô tả giao dịch")
        .setRequired(true)
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
    createEditButtons,
    getSortedPayments
  ) {
    await interaction.deferReply();

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

    if (!userQrData.has(sellerId)) {
      return interaction.editReply({
        content: `Seller chưa set QR! Dùng /setqr trước cho <@${sellerId}>.`,
        ephemeral: true,
      });
    }

    // Gen unique txId
    let txId;
    do {
      txId = `TX${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    } while (paymentsData.some((tx) => tx.id === txId));

    const newTx = {
      id: txId,
      buyerId,
      amount,
      description,
      status: "pending",
      date: new Date().toISOString(),
    };

    paymentsData.unshift(newTx);
    await savePaymentsData(newTx); // Pass newTx for sync

    const qrObj = userQrData.get(sellerId);

    try {
      // Gen QR buffer
      const qrBuffer = await QRCode.toBuffer(qrObj.url, {
        width: 256,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const attachment = new AttachmentBuilder(qrBuffer, { name: "my_qr.png" });

      // Embed kết hợp tx info + QR fields
      const embed = new EmbedBuilder()
        .setTitle("💳 Yêu cầu thanh toán")
        .addFields(
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
          // QR info từ qrObj
          {
            name: "Tên Chủ TK",
            value: qrObj.bank || "Chưa set",
            inline: false,
          },
          {
            name: "Số Tài Khoản",
            value: qrObj.account || "Chưa set",
            inline: false,
          },
          {
            name: "⚠️ CẢNH BÁO",
            value:
              "#**CẤM GHI MUA/BÁN VÀ CHỈNH SỬA NỘI DUNG - CỐ Ý GHI PHẠT 10%**",
            inline: false,
          },
          { name: "Quét QR để trả", value: "\u200B", inline: false }
        )
        .setColor("Blue")
        .setImage("attachment://my_qr.png")
        .setTimestamp()
        .setFooter({
          text: "Vui lòng kiểm tra thật kỹ khi chuyển khoản và gửi bill sau khi thanh toán thành công ",
        })
        .setThumbnail(qrObj.logo || null);

      await logMessage(
        "INFO",
        `[pay] Admin ${interaction.user.tag} tạo TX ${txId}: Buyer ${buyerTag} (${buyerId}) -> Seller ${sellerTag} (${sellerId}): ${amount} VNĐ - ${description}`
      );
      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        content: `<@${buyerId}> <@${sellerId}> Quét QR trên để thanh toán nhé!`,
      });
    } catch (error) {
      await logMessage(
        "ERROR",
        `[pay] Lỗi gen QR cho TX ${txId}: ${error.message}`
      );
      // Fallback embed không QR nếu gen fail
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
        content: `<@${buyerId}> <@${sellerId}>`,
      });
    }
  },
};
