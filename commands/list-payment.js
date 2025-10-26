const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("list-payments")
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
  async execute(
    interaction,
    userQrData,
    paymentsData,
    saveQrDataToSheet,
    savePaymentsToSheet,
    logMessage,
    QRCode,
    AttachmentBuilder,
    createQrEmbed,
    createEditButtons,
    getSortedPayments
  ) {
    try {
      if (typeof logMessage !== "function") {
        throw new Error("logMessage is not a function");
      }

      const statusFilter = interaction.options.getString("status");
      const validStatuses = ["pending", "confirmed", "cancelled"];

      if (statusFilter && !validStatuses.includes(statusFilter)) {
        return interaction.reply({
          content: "Trạng thái không hợp lệ! Chọn: pending, confirmed, cancelled.",
          ephemeral: true,
        });
      }

      const sortedPayments = getSortedPayments();
      if (!Array.isArray(sortedPayments)) {
        throw new Error("Không thể lấy danh sách giao dịch.");
      }

      const filteredTxs = statusFilter
        ? sortedPayments.filter((t) => t.status === statusFilter)
        : sortedPayments;

      if (filteredTxs.length === 0) {
        return interaction.reply({
          content: "Không có giao dịch nào!",
          ephemeral: false,
        });
      }

      // Tính tổng số tiền confirmed
      const totalConfirmed = paymentsData
        .filter((tx) => tx.status === "confirmed")
        .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

      // Lấy tag của seller từ DEFAULT_SELLER_ID
      let sellerTag = "Unknown Seller";
      const sellerId = process.env.DEFAULT_SELLER_ID;
      if (sellerId) {
        try {
          const seller = await interaction.client.users.fetch(sellerId);
          sellerTag = seller.tag; // Lấy username#discriminator
        } catch (error) {
          console.error(`[${new Date().toLocaleString("vi-VN")}] [ERROR] [list-payments] Lỗi khi lấy thông tin seller: ${error.message}`);
          await logMessage("ERROR", `Lỗi khi lấy thông tin seller từ ID ${sellerId}: ${error.message}`);
        }
      }

      // Phân trang
      const pageSize = 10; // Số giao dịch mỗi trang
      let currentPage = 0;
      const totalPages = Math.ceil(filteredTxs.length / pageSize);

      // Hàm tạo embed cho trang cụ thể
      const createEmbed = (page) => {
        const start = page * pageSize;
        const end = start + pageSize;
        const recentTxs = filteredTxs.slice(start, end);
        const list = recentTxs
          .map(
            (tx) =>
              `${
                tx.status === "confirmed" ? "✅" : tx.status === "cancelled" ? "❌" : "⏳"
              } ${tx.id} - ${tx.amount.toLocaleString("vi-VN", {
                style: "currency",
                currency: "VND",
              })} (<@${tx.buyerId}> -> ${sellerTag}) - ${new Date(tx.date).toLocaleDateString("vi-VN")}`
          )
          .join("\n");

        const maxFieldLength = 1024;
        const truncatedList = list.length > maxFieldLength ? list.slice(0, maxFieldLength - 3) + "..." : list;

        return new EmbedBuilder()
          .setTitle(`📋 Danh sách giao dịch ${statusFilter ? `(${statusFilter})` : ""}`)
          .addFields(
            { name: "Tổng số giao dịch", value: filteredTxs.length.toString(), inline: true },
            {
              name: "Tổng số tiền (Confirmed)",
              value: totalConfirmed.toLocaleString("vi-VN", { style: "currency", currency: "VND" }),
              inline: true,
            },
            { name: `Trang ${page + 1}/${totalPages}`, value: truncatedList || "N/A" }
          )
          .setColor("Blue")
          .setTimestamp();
      };

      // Tạo nút Previous và Next
      const createButtons = (page) => {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prev_page_${interaction.id}`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`next_page_${interaction.id}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages - 1)
        );
        return row;
      };

      // Gửi embed ban đầu
      await interaction.reply({
        embeds: [createEmbed(currentPage)],
        components: totalPages > 1 ? [createButtons(currentPage)] : [],
        ephemeral: false,
      });

      // Ghi log
      await logMessage(
        "INFO",
        `[list-payments] Admin ${interaction.user.tag} xem ${filteredTxs.length} tx${
          statusFilter ? ` (${statusFilter})` : ""
        }, Tổng Confirmed: ${totalConfirmed.toLocaleString("vi-VN", { style: "currency", currency: "VND" })}`
      );

      // Tạo collector để xử lý nút
      if (totalPages > 1) {
        const filter = (i) =>
          (i.customId === `prev_page_${interaction.id}` || i.customId === `next_page_${interaction.id}`) &&
          i.user.id === interaction.user.id;

        const collector = interaction.channel.createMessageComponentCollector({
          filter,
          time: 300000, // 5 phút
        });

        collector.on("collect", async (i) => {
          try {
            if (i.customId === `prev_page_${interaction.id}`) {
              currentPage = Math.max(0, currentPage - 1);
            } else if (i.customId === `next_page_${interaction.id}`) {
              currentPage = Math.min(totalPages - 1, currentPage + 1);
            }

            await i.update({
              embeds: [createEmbed(currentPage)],
              components: [createButtons(currentPage)],
            });

            await logMessage(
              "INFO",
              `[list-payments] Admin ${interaction.user.tag} chuyển sang trang ${currentPage + 1}`
            );
          } catch (error) {
            console.error(`[${new Date().toLocaleString("vi-VN")}] [ERROR] [list-payments] Lỗi xử lý nút: ${error.message} (User: ${interaction.user.tag})`);
            await i.followUp({
              content: "Lỗi khi chuyển trang. Thử lại sau.",
              ephemeral: true,
            });
          }
        });

        collector.on("end", async (collected, reason) => {
          try {
            if (reason === "time") {
              await interaction.editReply({
                components: [],
                content: "Thời gian thao tác đã hết. Chạy lại lệnh để tiếp tục.",
              });
            }
          } catch (error) {
            console.error(`[${new Date().toLocaleString("vi-VN")}] [ERROR] [list-payments] Lỗi khi kết thúc collector: ${error.message}`);
          }
        });
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleString("vi-VN")}] [ERROR] [list-payments] Lỗi: ${error.message} (User: ${interaction.user.tag})`);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: "Lỗi khi liệt kê giao dịch. Thử lại sau.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Lỗi khi liệt kê giao dịch. Thử lại sau.",
          ephemeral: true,
        });
      }
    }
  },
};