const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Xem chi tiết hoặc tổng tiền đã trả (admin only)")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch (hoặc dùng user)")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Buyer để xem tổng tiền đã trả")
        .setRequired(false)
    ),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const txCode = interaction.options
      .getString("transaction_code")
      ?.toUpperCase();
    const targetUser = interaction.options.getUser("user");

    if (txCode) {
      const tx = paymentService
        .getSortedPayments()
        .find((t) => t.id === txCode);
      if (!tx) {
        return interaction.editReply({
          content: "Giao dịch không tồn tại!",
          ephemeral: true,
        });
      }

      let sellerTag = "Seller Fixed";
      const sellerId = process.env.DEFAULT_SELLER_ID;
      if (sellerId) {
        try {
          const seller = await interaction.client.users.fetch(sellerId);
          sellerTag = seller.tag;
        } catch (error) {
          await logger.error(
            `Lỗi lấy seller info khi xem info TX ${txCode}: ${error.message}`,
            SHEETS_ID
          );
        }
      }

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
          { name: "Seller", value: sellerTag, inline: true },
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

      await logger.info(
        `[info] Admin ${interaction.user.tag} xem chi tiết TX ${txCode}`,
        SHEETS_ID
      );

      await interaction.editReply({ embeds: [embed], ephemeral: false });
    } else if (targetUser) {
      const userId = targetUser.id;
      const userTxs = paymentService
        .getSortedPayments()
        .filter((t) => t.buyerId === userId && t.status === "confirmed");
      const totalAmount = userTxs.reduce((sum, tx) => sum + tx.amount, 0);
      const completedCount = userTxs.length;
      const avgAmount =
        completedCount > 0
          ? (totalAmount / completedCount).toLocaleString()
          : "0";

      await logger.info(
        `[info] Admin ${interaction.user.tag} xem tổng buyer ${targetUser.tag} (${userId}): ${totalAmount} VNĐ`,
        SHEETS_ID
      );

      if (userTxs.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle(`👤 ${targetUser.username} (Buyer - Tiền đã trả)`)
          .addFields(
            { name: "💰 Tổng", value: "0 VNĐ", inline: true },
            { name: "📊 Số giao dịch hoàn thành", value: "0", inline: true },
            { name: "📋 Danh sách", value: "Chưa có giao dịch confirmed." }
          )
          .setColor("Grey")
          .setTimestamp();

        return interaction.editReply({ embeds: [embed], ephemeral: false });
      }

      if (userTxs.length <= 3) {
        const list = userTxs
          .slice(-3)
          .reverse()
          .map(
            (tx) =>
              `✅ ${tx.id} - ${tx.amount.toLocaleString()} VNĐ - ${new Date(
                tx.date
              ).toLocaleDateString("vi-VN")}`
          )
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle(`👤 ${targetUser.username} (Buyer - Tiền đã trả)`)
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
            {
              name: "📈 Trung bình/giao dịch",
              value: `${avgAmount} VNĐ`,
              inline: true,
            },
            { name: "📋 Danh sách giao dịch (gần nhất)", value: list }
          )
          .setColor("Blue")
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], ephemeral: false });
      } else {
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
              `👤 ${targetUser.username} (Buyer - Tiền đã trả) - Trang ${
                pageNum + 1
              }/${totalPages}`
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
              {
                name: "📈 Trung bình/giao dịch",
                value: `${avgAmount} VNĐ`,
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
            .setCustomId(`prev_info_${userId}_${page}`)
            .setLabel("Trước")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`next_info_${userId}_${page}`)
            .setLabel("Sau")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === totalPages - 1)
        );

        await interaction.editReply({
          embeds: [embed],
          components: [row],
          ephemeral: false,
        });

        const collector = interaction.channel.createMessageComponentCollector({
          filter: (i) =>
            i.user.id === interaction.user.id &&
            (i.customId.startsWith("prev_info_") ||
              i.customId.startsWith("next_info_")),
          time: 300000,
        });

        collector.on("collect", async (i) => {
          await i.deferUpdate();

          const parts = i.customId.split("_");
          const action = parts[0];
          let newPage = page;
          if (action === "prev" && newPage > 0) newPage--;
          if (action === "next" && newPage < totalPages - 1) newPage++;

          page = newPage;

          const newEmbed = getPageEmbed(page);
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`prev_info_${userId}_${page}`)
              .setLabel("Trước")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId(`next_info_${userId}_${page}`)
              .setLabel("Sau")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === totalPages - 1)
          );

          await i.editReply({ embeds: [newEmbed], components: [newRow] });
        });

        collector.on("end", () => {
          interaction.editReply({ components: [] }).catch(() => {});
        });
      }
    } else {
      await interaction.editReply({
        content: "Cần transaction_code hoặc user (buyer)!",
        ephemeral: true,
      });
    }
  },
};
