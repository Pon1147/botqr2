const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const path = require("path");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Xem top buyer theo tổng amount confirmed 💰"),

  cooldown: 30,

  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    try {
      // Đường dẫn asset từ root
      const bannerPath = path.join(process.cwd(), "src", "assets", "banner.png");
      const bannerAttachment = new AttachmentBuilder(bannerPath, {
        name: "banner.png",
      });

      const confirmedPayments =
        paymentService
          .getSortedPayments()
          ?.filter((tx) => tx.status === "confirmed" && tx.amount > 0) || [];

      if (confirmedPayments.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xffc0cb)
          .setTitle("🏆 TOP BUYER")
          .setDescription("Chưa có payment confirmed nào để rank top! 😅")
          .setTimestamp()
          .setImage("attachment://banner.png");

        // Sử dụng reply nếu chưa reply/deferred, editReply nếu đã defer
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply({
            embeds: [embed],
            files: [bannerAttachment],
          });
        } else {
          return interaction.reply({
            embeds: [embed],
            files: [bannerAttachment],
          });
        }
      }

      // Aggregate sum
      const buyerTotals = {};
      confirmedPayments.forEach((tx) => {
        const buyerId = tx.buyerId;
        const amt = tx.amount || 0;
        buyerTotals[buyerId] = (buyerTotals[buyerId] || 0) + amt;
      });

      const sortedBuyers = Object.entries(buyerTotals).sort(([, a], [, b]) => b - a);
      const top10Buyers = sortedBuyers.slice(0, 10);

      // Rank user hiện tại
      const currentUserId = interaction.user.id;
      const currentUserTotal = buyerTotals[currentUserId] || 0;
      const currentRankIndex = sortedBuyers.findIndex(([id]) => id === currentUserId);
      const currentRank = currentRankIndex >= 0 ? currentRankIndex + 1 : null;
      let trackingMsg = "";
      if (currentUserTotal > 0) {
        trackingMsg = `Bạn đang ở top ${currentRank} với ${currentUserTotal.toLocaleString("vi-VN")} VNĐ 💪`;
      }

      // Cache username
      const buyerTagCache = new Map();

      const topBuyers = await Promise.all(
        top10Buyers.map(async ([buyerId, total], index) => {
          await new Promise((r) => setTimeout(r, index * 100));

          let username = `Unknown (${buyerId.slice(-4)})`;
          if (!buyerTagCache.has(buyerId)) {
            try {
              const user = await interaction.client.users.fetch(buyerId, { cache: true });
              username = user.globalName || user.username || "Unknown User";
              buyerTagCache.set(buyerId, username);
            } catch (err) {
              logger.error(`Fetch user ${buyerId} fail: ${err.message}`, SHEETS_ID);
            }
          } else {
            username = buyerTagCache.get(buyerId);
          }

          return { rank: index + 1, username, total };
        })
      );

      let top3Value = "Chưa đủ 3 người góp gạo! 💕";
      if (topBuyers.length >= 3) {
        const top1 = topBuyers[0];
        const top2 = topBuyers[1];
        const top3 = topBuyers[2];
        top3Value = [
          `<a:6322number1:1437342558626906174> **${top1.username}** - ${top1.total.toLocaleString("vi-VN")} VNĐ 🥇`,
          `<a:1656number2:1437342547315003553> **${top2.username}** - ${top2.total.toLocaleString("vi-VN")} VNĐ 🥈`,
          `<a:5370number3:1437342556613509190> **${top3.username}** - ${top3.total.toLocaleString("vi-VN")} VNĐ 🥉`,
        ].join("\n");
      }

      const restBuyers = topBuyers.slice(3);
      let restValue =
        restBuyers
          .map((buyer) => `${buyer.rank}. ${buyer.username} - ${buyer.total.toLocaleString("vi-VN")} VNĐ`)
          .join("\n") || "Chưa có người góp gạo khác! 🌟";

      const embed = new EmbedBuilder()
        .setColor(0xffc0cb)
        .setTitle(
          "<a:1719lpinkwing:1428650560072192113> DANH SÁCH TOP 10 GÓP GẠO NUÔI YÊN <a:40349rpinkwings:1428650540904087654>"
        )
        .addFields(
          {
            name: "<a:schoolboy:1428754537677590629> TOP 3 BUYER GÓP NHIỀU GẠO NHẤT <a:schoolboy:1428754537677590629>",
            value: top3Value,
            inline: false,
          },
          {
            name: "<a:dpround:1428754521043243069> TOP 4-10 <a:dpround:1428754521043243069>",
            value: restValue,
            inline: false,
          }
        )
        .setTimestamp()
        .setFooter({
          text: trackingMsg || "Cảm ơn tất cả các bạn đã ủng hộ! 🌟",
        })
        .setImage("attachment://banner.png");

      // Reply hoặc editReply dựa trên trạng thái
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          embeds: [embed],
          files: [bannerAttachment],
        });
      } else {
        await interaction.reply({
          embeds: [embed],
          files: [bannerAttachment],
        });
      }

      await logger.info(
        `[top] User ${interaction.user.tag} gọi /top: ${topBuyers.length} buyers, rank: ${currentRank ?? "N/A"}`,
        SHEETS_ID
      );
    } catch (error) {
      logger.error(`Lỗi /top: ${error.message}`, SHEETS_ID);

      const errorMsg = { content: "Có lỗi khi tải bảng xếp hạng. Thử lại sau nhé!", flags: 64 };

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMsg).catch(() => {});
      } else {
        await interaction.reply(errorMsg).catch(() => {});
      }
    }
  },
};