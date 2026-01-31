const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Xem top buyer theo tổng amount confirmed 💰"),
  async execute(interaction, config) {
    const { paymentService, logger, SHEETS_ID } = config;

    const bannerPath = path.join(__dirname, "../assets/banner.png");
    const bannerAttachment = new AttachmentBuilder(bannerPath, {
      name: "banner.png",
    });

    // ... phần còn lại giữ nguyên, embed.setImage("attachment://banner.png");

    const confirmedPayments = paymentService
      .getSortedPayments()
      .filter((tx) => tx.status === "confirmed" && tx.amount > 0);

    if (confirmedPayments.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xffc0cb)
        .setTitle("🏆 TOP BUYER")
        .setDescription("Chưa có payment confirmed nào để rank top! 😅")
        .setTimestamp()
        .setImage("attachment://banner.png");

      return interaction.editReply({
        embeds: [embed],
        files: [bannerAttachment],
      });
    }

    // Aggregate sum amount per buyerId
    const buyerTotals = {};
    confirmedPayments.forEach((tx) => {
      const buyerId = tx.buyerId;
      const amt = tx.amount || 0;
      buyerTotals[buyerId] = (buyerTotals[buyerId] || 0) + amt;
    });

    // Sort desc toàn bộ để tính rank chính xác
    const sortedBuyers = Object.entries(buyerTotals).sort(
      ([, a], [, b]) => b - a
    );

    // Top 10
    const top10Buyers = sortedBuyers.slice(0, 10);

    // Rank của user hiện tại
    const currentUserId = interaction.user.id;
    const currentUserTotal = buyerTotals[currentUserId] || 0;
    const currentRank =
      sortedBuyers.findIndex(([id]) => id === currentUserId) + 1;
    let trackingMsg = "";
    if (currentUserTotal > 0) {
      trackingMsg = `Bạn đang ở top ${currentRank} với ${currentUserTotal.toLocaleString(
        "vi-VN"
      )} VNĐ 💪`;
    }

    // Cache user tag
    const buyerTagCache = new Map();

    const topBuyers = await Promise.all(
      top10Buyers.map(async ([buyerId, total], index) => {
        await new Promise((resolve) => setTimeout(resolve, index * 50));
        let username = `Unknown User (${buyerId.slice(-4)})`;
        if (!buyerTagCache.has(buyerId)) {
          try {
            const user = await interaction.client.users.fetch(buyerId);
            username = user.globalName || user.username || "Unknown User";
            buyerTagCache.set(buyerId, username);
          } catch (fetchError) {
            await logger.error(
              `Fetch user ${buyerId} fail: ${fetchError.message}`,
              SHEETS_ID
            );
          }
        } else {
          username = buyerTagCache.get(buyerId);
        }
        return {
          rank: index + 1,
          username,
          total,
        };
      })
    );

    // Top 3
    let top3Value = "";
    if (topBuyers.length >= 3) {
      const top1 = topBuyers[0];
      const top2 = topBuyers[1];
      const top3 = topBuyers[2];
      top3Value =
        `<a:6322number1:1437342558626906174> **${
          top1.username
        }** - ${top1.total.toLocaleString("vi-VN")} VNĐ 🥇\n` +
        `<a:1656number2:1437342547315003553> **${
          top2.username
        }** - ${top2.total.toLocaleString("vi-VN")} VNĐ 🥈\n` +
        `<a:5370number3:1437342556613509190> **${
          top3.username
        }** - ${top3.total.toLocaleString("vi-VN")} VNĐ 🥉`;
    } else {
      top3Value = "Chưa đủ 3 người góp gạo! 💕";
    }

    // Top 4-10
    const restBuyers = topBuyers.slice(3);
    let restValue = restBuyers
      .map(
        (buyer) =>
          `${buyer.rank}. ${buyer.username} - ${buyer.total.toLocaleString(
            "vi-VN"
          )} VNĐ`
      )
      .join("\n");
    if (restBuyers.length === 0) {
      restValue = "Chưa có người góp gạo khác! 🌟";
    }

    const embed = new EmbedBuilder()
      .setColor(0xffc0cb)
      .setTitle(
        `<a:1719lpinkwing:1428650560072192113> DANH SÁCH TOP 10 GÓP GẠO NUÔI YÊN <a:40349rpinkwings:1428650540904087654>`
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

    await interaction.editReply({ embeds: [embed], files: [bannerAttachment] });

    await logger.info(
      `[top] User ${interaction.user.tag} gọi /top: ${
        topBuyers.length
      } buyers, rank của bạn: ${currentRank > 0 ? currentRank : "N/A"}`,
      SHEETS_ID
    );
  },
};
