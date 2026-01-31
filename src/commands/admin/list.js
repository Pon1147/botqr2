const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("list")
    .setDescription("Liệt kê tất cả giao dịch (admin only)")
    .addStringOption((option) =>
      option
        .setName("status")
        .setDescription("Lọc trạng thái: pending, confirmed, cancelled")
        .setRequired(false)
        .addChoices(
          { name: "Pending", value: "pending" },
          { name: "Confirmed", value: "confirmed" },
          { name: "Cancelled", value: "cancelled" }
        )
    ),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const statusFilter = interaction.options.getString("status");
    const validStatuses = ["pending", "confirmed", "cancelled"];

    if (statusFilter && !validStatuses.includes(statusFilter)) {
      return interaction.editReply({
        content:
          "Trạng thái không hợp lệ! Chọn: pending, confirmed, cancelled.",
        ephemeral: true,
      });
    }

    const sortedPayments = paymentService.getSortedPayments();
    const filteredTxs = statusFilter
      ? sortedPayments.filter((t) => t.status === statusFilter)
      : sortedPayments;

    if (filteredTxs.length === 0) {
      return interaction.editReply({
        content: "Không có giao dịch nào!",
        ephemeral: false,
      });
    }

    const totalConfirmed = paymentService.getTotalConfirmed();

    let sellerTag = "Seller Fixed";
    const sellerId = process.env.DEFAULT_SELLER_ID;
    if (sellerId) {
      try {
        const seller = await interaction.client.users.fetch(sellerId);
        sellerTag = seller.tag;
      } catch (error) {
        await logger.error(
          `Lỗi lấy seller info khi list TX: ${error.message}`,
          SHEETS_ID
        );
      }
    }

    const pageSize = 10;
    let currentPage = 0;
    const totalPages = Math.ceil(filteredTxs.length / pageSize);

    const createEmbed = (page) => {
      const start = page * pageSize;
      const end = start + pageSize;
      const pageTxs = filteredTxs.slice(start, end);
      const list = pageTxs
        .map(
          (tx) =>
            `${
              tx.status === "confirmed"
                ? "✅"
                : tx.status === "cancelled"
                ? "❌"
                : "⏳"
            } ${tx.id} - ${tx.amount.toLocaleString("vi-VN", {
              style: "currency",
              currency: "VND",
            })} (<@${tx.buyerId}> -> ${sellerTag}) - ${new Date(
              tx.date
            ).toLocaleDateString("vi-VN")}`
        )
        .join("\n");

      const maxFieldLength = 1024;
      const truncatedList =
        list.length > maxFieldLength
          ? list.slice(0, maxFieldLength - 3) + "..."
          : list;

      return new EmbedBuilder()
        .setTitle(
          `📋 Danh sách giao dịch ${statusFilter ? `(${statusFilter})` : ""}`
        )
        .addFields(
          {
            name: "Tổng số giao dịch",
            value: filteredTxs.length.toString(),
            inline: true,
          },
          {
            name: "Tổng số tiền (Confirmed)",
            value: totalConfirmed.toLocaleString("vi-VN", {
              style: "currency",
              currency: "VND",
            }),
            inline: true,
          },
          {
            name: `Trang ${page + 1}/${totalPages}`,
            value: truncatedList || "N/A",
          }
        )
        .setColor("Blue")
        .setTimestamp();
    };

    const createButtons = (page) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`prev_list_${interaction.id}`)
          .setLabel("Previous")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`next_list_${interaction.id}`)
          .setLabel("Next")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages - 1)
      );
    };

    await interaction.editReply({
      embeds: [createEmbed(currentPage)],
      components: totalPages > 1 ? [createButtons(currentPage)] : [],
      ephemeral: false,
    });

    await logger.info(
      `[list] Admin ${interaction.user.tag} xem ${filteredTxs.length} tx${
        statusFilter ? ` (${statusFilter})` : ""
      }, Tổng Confirmed: ${totalConfirmed.toLocaleString("vi-VN", {
        style: "currency",
        currency: "VND",
      })}`,
      SHEETS_ID
    );

    if (totalPages > 1) {
      const collector = interaction.channel.createMessageComponentCollector({
        // ← Sửa: dùng channel
        filter: (i) =>
          i.user.id === interaction.user.id &&
          (i.customId === `prev_list_${interaction.id}` ||
            i.customId === `next_list_${interaction.id}`),
        time: 300000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();

        if (i.customId === `prev_list_${interaction.id}`) {
          currentPage = Math.max(0, currentPage - 1);
        } else {
          currentPage = Math.min(totalPages - 1, currentPage + 1);
        }

        await i.editReply({
          embeds: [createEmbed(currentPage)],
          components: [createButtons(currentPage)],
        });

        await logger.info(
          `[list] Admin ${interaction.user.tag} chuyển sang trang ${
            currentPage + 1
          }`,
          SHEETS_ID
        );
      });

      collector.on("end", async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      });
    }
  },
};
