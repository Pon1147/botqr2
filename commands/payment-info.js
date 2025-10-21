// commands/payment-info.js - Admin Only, Public Reply
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-info")
    .setDescription("Xem chi tiết giao dịch (admin only)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch (hoặc dùng user)")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User để xem tổng giao dịch")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Loại: seller (tiền nhận) hoặc buyer (tiền trả)")
        .setRequired(false)
        .addChoices(
          { name: "Seller (tiền nhận)", value: "seller" },
          { name: "Buyer (tiền trả)", value: "buyer" }
        )
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

    const txCode = interaction.options
      .getString("transaction_code")
      ?.toUpperCase();
    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type") || "seller";

    if (txCode) {
      const tx = paymentsData.find((t) => t.id === txCode);
      if (!tx)
        return interaction.editReply({
          content: "Giao dịch không tồn tại!",
          ephemeral: true,
        });

      const embed = new EmbedBuilder()
        .setTitle(`📋 Chi tiết TX ${tx.id}`)
        .addFields(
          {
            name: "Trạng thái",
            value:
              tx.status === "confirmed"
                ? "✅ Hoàn thành"
                : tx.status === "cancelled"
                ? "❌ Hủy"
                : "⏳ Chờ",
            inline: true,
          },
          {
            name: "Số tiền",
            value: `${tx.amount.toLocaleString()} VNĐ`,
            inline: true,
          },
          { name: "Buyer", value: `<@${tx.buyerId}>`, inline: true },
          { name: "Seller", value: `<@${tx.sellerId}>`, inline: true },
          { name: "Mô tả", value: tx.description || "N/A" },
          {
            name: "Ngày tạo",
            value: new Date(tx.date).toLocaleDateString("vi-VN"),
            inline: true,
          },
          {
            name: "Ngày xử lý",
            value: tx.processedDate
              ? new Date(tx.processedDate).toLocaleDateString("vi-VN")
              : "N/A",
            inline: true,
          },
          ...(tx.reason ? [{ name: "Lý do hủy", value: tx.reason }] : [])
        )
        .setColor(
          tx.status === "confirmed"
            ? "Green"
            : tx.status === "cancelled"
            ? "Red"
            : "Blue"
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], ephemeral: false });
    } else if (targetUser) {
      const userId = targetUser.id;
      const userTxs = paymentsData.filter((t) => {
        if (type === "seller")
          return t.sellerId === userId && t.status === "confirmed";
        if (type === "buyer")
          return t.buyerId === userId && t.status === "confirmed";
        return false;
      });
      const totalAmount = userTxs.reduce((sum, tx) => sum + tx.amount, 0);
      const completedCount = userTxs.length;

      if (userTxs.length <= 3) {
        const list =
          userTxs
            .slice(-3)
            .reverse()
            .map(
              (tx) =>
                `✅ ${tx.id} - ${tx.amount.toLocaleString()} VNĐ - ${new Date(
                  tx.date
                ).toLocaleDateString("vi-VN")}`
            )
            .join("\n") || "Chưa có giao dịch";

        const embed = new EmbedBuilder()
          .setTitle(
            `👤 ${targetUser.username} (${
              type === "seller" ? "Seller - Tiền nhận" : "Buyer - Tiền trả"
            })`
          )
          .addFields(
            {
              name: "💰 Tổng",
              value: `${totalAmount.toLocaleString()} VNĐ`,
              inline: true,
            },
            {
              name: "📊 Số giao dịch hoàn thành",
              value: completedCount.toString(),
              inline: true,
            },
            { name: "📋 Danh sách giao dịch (gần nhất)", value: list }
          )
          .setColor("Blue")
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], ephemeral: false });
      } else {
        // Pagination: Simple next/prev buttons for first 10, but limit to 3 pages for simplicity
        let page = 0;
        const perPage = 5;
        const totalPages = Math.ceil(userTxs.length / perPage);

        function getPageEmbed(pageNum) {
          const start = pageNum * perPage;
          const end = start + perPage;
          const pageTxs = userTxs.slice(start, end).reverse();
          const list =
            pageTxs
              .map(
                (tx) =>
                  `✅ ${tx.id} - ${tx.amount.toLocaleString()} VNĐ - ${new Date(
                    tx.date
                  ).toLocaleDateString("vi-VN")}`
              )
              .join("\n") || "Chưa có giao dịch";

          return new EmbedBuilder()
            .setTitle(
              `👤 ${targetUser.username} (${
                type === "seller" ? "Seller - Tiền nhận" : "Buyer - Tiền trả"
              }) - Trang ${pageNum + 1}/${totalPages}`
            )
            .addFields(
              {
                name: "💰 Tổng",
                value: `${totalAmount.toLocaleString()} VNĐ`,
                inline: true,
              },
              {
                name: "📊 Số giao dịch hoàn thành",
                value: completedCount.toString(),
                inline: true,
              },
              { name: "📋 Danh sách giao dịch", value: list }
            )
            .setColor("Blue")
            .setTimestamp();
        }

        const embed = getPageEmbed(page);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prev_info_${userId}_${type}_${page}`)
            .setLabel("Trước")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`next_info_${userId}_${type}_${page}`)
            .setLabel("Sau")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1)
        );

        const message = await interaction.editReply({
          embeds: [embed],
          components: [row],
          ephemeral: false,
        });

        // Collector for buttons (simple, expires in 5min)
        const collector = message.createMessageComponentCollector({
          time: 300000,
        });
        collector.on("collect", async (i) => {
          if (i.user.id !== interaction.user.id)
            return i.reply({ content: "Không phải của bạn!", ephemeral: true });
          const [action, , , , currentPage] = i.customId.split("_");
          let newPage = parseInt(currentPage);
          if (action === "prev" && newPage > 0) newPage--;
          if (action === "next" && newPage < totalPages - 1) newPage++;
          const newEmbed = getPageEmbed(newPage);
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`prev_info_${userId}_${type}_${newPage}`)
              .setLabel("Trước")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === 0),
            new ButtonBuilder()
              .setCustomId(`next_info_${userId}_${type}_${newPage}`)
              .setLabel("Sau")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === totalPages - 1)
          );
          await i.update({ embeds: [newEmbed], components: [newRow] });
        });
        collector.on("end", () => {
          message.edit({ components: [] }).catch(() => {});
        });
      }
    } else {
      await interaction.editReply({
        content: "Cần transaction_code hoặc user + type!",
        ephemeral: true,
      });
    }
  },
};
