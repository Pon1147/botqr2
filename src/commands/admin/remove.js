const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Xoa han mot payment da confirm (admin only)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Ma TX can xoa (vi du: TXA1B2C3D4)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Ly do xoa (khach quan)")
        .setRequired(true)
    ),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const txIdRaw = interaction.options.getString("transaction_code");
    if (!txIdRaw) {
      return interaction.editReply({
        content: "Vui long nhap ma TX!",
        ephemeral: true,
      });
    }
    const txId = txIdRaw.toUpperCase().trim();

    const reason =
      interaction.options.getString("reason")?.trim() || "Khong co ly do";

    const existingTx = paymentService.getPaymentById(txId);
    if (!existingTx) {
      return interaction.editReply({
        content: `Khong tim thay payment voi ma **${txId}**.`,
        ephemeral: true,
      });
    }

    if (existingTx.status !== "confirmed") {
      return interaction.editReply({
        content: `Chi co the xoa payment da **confirmed**. Ma **${txId}** hien tai la **${existingTx.status}**.`,
        ephemeral: true,
      });
    }

    const removedTx = paymentService.removePaymentById(txId);
    if (!removedTx) {
      return interaction.editReply({
        content: `Khong the xoa payment **${txId}**. Thu lai sau.`,
        ephemeral: true,
      });
    }

    await paymentService.savePaymentsToSheet(SHEETS_ID);

    let sellerTag = "Seller Fixed";
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag;
      } catch (error) {
        await logger.error(
          `Loi lay seller info khi remove TX ${txId}: ${error.message}`,
          SHEETS_ID
        );
      }
    }

    await logger.info(
      `[remove] Admin ${interaction.user.tag} (${interaction.user.id}) da xoa TX ${txId}: ${removedTx.amount.toLocaleString()} VND - Buyer <@${removedTx.buyerId}> - Seller ${sellerTag} - Ly do: ${reason}`,
      SHEETS_ID
    );

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("Payment da bi xoa boi Admin")
      .setDescription(
        `Ma giao dich **${txId}** da bi xoa khoi he thong vi ly do khach quan.`
      )
      .addFields(
        {
          name: "So tien",
          value: `${removedTx.amount.toLocaleString()} VND`,
          inline: true,
        },
        { name: "Buyer", value: `<@${removedTx.buyerId}>`, inline: true },
        { name: "Seller", value: sellerTag, inline: true },
        {
          name: "Mo ta",
          value: removedTx.description || "Khong co",
          inline: false,
        },
        { name: "Ly do xoa", value: reason, inline: false },
        {
          name: "Thuc hien boi",
          value: `<@${interaction.user.id}>`,
          inline: false,
        }
      )
      .setTimestamp()
      .setFooter({ text: "Bot QR - Payment Management" });

    await interaction.editReply({
      embeds: [embed],
      content: `<@${removedTx.buyerId}> Thanh toan cua ban (ma **${txId}**) da bi admin xoa vi: **${reason}**.`,
      ephemeral: false,
    });
  },
};

