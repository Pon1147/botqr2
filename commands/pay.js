const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { v4: uuidv4 } = require("uuid");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Tạo yêu cầu thanh toán (admin only)")
    .addUserOption((option) =>
      option
        .setName("buyer")
        .setDescription("Người trả tiền (buyer)")
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("seller")
        .setDescription("Người nhận tiền (seller)")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("amount").setDescription("Số tiền (VNĐ)").setRequired(true)
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
    createEditButtons
  ) {
    await interaction.deferReply();

    const buyer = interaction.options.getUser("buyer");
    const seller = interaction.options.getUser("seller");
    const amount = interaction.options.getInteger("amount");
    const description = interaction.options.getString("description");
    const buyerId = buyer.id;
    const sellerId = seller.id;
    const buyerTag = buyer.tag;
    const sellerTag = seller.tag;

    if (amount <= 0) {
      return interaction.editReply({
        content: "Số tiền phải lớn hơn 0!",
        ephemeral: true,
      });
    }

    if (!userQrData.has(sellerId)) {
      return interaction.editReply({
        content: `${seller} chưa set QR! Dùng /setqr trước.`,
        ephemeral: true,
      });
    }

    const txId = `TX${uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    const newTx = {
      id: txId,
      buyerId,
      sellerId,
      amount,
      description,
      status: "pending",
      date: new Date().toISOString(),
    };

    paymentsData.unshift(newTx);
    paymentsData.sort((a, b) => new Date(b.date) - new Date(a.date));
    await savePaymentsData();

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
        { name: "Trạng thái", value: "⏳ Chờ xác nhận" }
      )
      .setColor("Blue")
      .setTimestamp();

    await logMessage(
      `[pay] Admin ${interaction.user.tag} tạo TX ${txId}: Buyer ${buyerTag} (${buyerId}) -> Seller ${sellerTag} (${sellerId}): ${amount} VNĐ - ${description}`
    );
    await interaction.editReply({
      embeds: [embed],
      content: `<@${buyerId}> <@${sellerId}>`, // Notify mention
    });
  },
};
