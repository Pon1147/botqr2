const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Xem top buyer theo tổng amount confirmed 💰"),
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
    getSortedPayments,
    loadCapitalFromSheet,
    saveCapitalToSheet,
    capitalData
  ) {
    await interaction.deferReply();

    try {
      // Load banner attachment (giả sử banner.png trong thư mục repo)
      const bannerAttachment = new AttachmentBuilder("banner.png", {
        name: "banner.png",
      });

      // Filter chỉ confirmed payments
      const confirmedPayments = paymentsData.filter(
        (tx) => tx.status === "confirmed" && tx.amount > 0
      );

      if (confirmedPayments.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xffc0cb)
          .setTitle("🏆 TOP BUYER")
          .setDescription("Chưa có payment confirmed nào để rank top! 😅")
          .setTimestamp()
          .setImage("attachment://banner.png");
        return interaction
          .editReply({ embeds: [embed], files: [bannerAttachment] })
          .catch((err) => {
            logMessage("ERROR", `Fallback empty top: ${err.message}`);
            interaction.followUp({
              embeds: [embed],
              files: [bannerAttachment],
              ephemeral: true,
            });
          });
      }

      // Aggregate: sum amount per buyerId
      const buyerTotals = {};
      confirmedPayments.forEach((tx) => {
        const buyerId = tx.buyerId;
        const amt = tx.amount || 0;
        buyerTotals[buyerId] = (buyerTotals[buyerId] || 0) + amt;
      });

      // Sort all desc by total để tính rank
      const sortedBuyers = Object.entries(buyerTotals).sort(
        ([, a], [, b]) => b - a
      );

      // Giới hạn top 10
      const top10Buyers = sortedBuyers.slice(0, 10);

      // Tìm rank của user hiện tại (trong top 10 hoặc >10)
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

      // Top 10 với username fetch (batch delay để tránh rate limit)
      const topBuyersPromises = top10Buyers.map(
        async ([buyerId, total], index) => {
          // Delay batch 50ms/user để giảm lag
          await new Promise((resolve) => setTimeout(resolve, index * 50));
          let username = `Unknown User (${buyerId.slice(-4)})`;
          try {
            const user = await interaction.client.users.fetch(buyerId);
            username = user.globalName || user.username || "Unknown User";
          } catch (fetchError) {
            console.error(`Fetch user ${buyerId} fail: ${fetchError.message}`);
          }
          return {
            rank: top10Buyers.findIndex(([id]) => id === buyerId) + 1,
            username,
            total,
          };
        }
      );

      const topBuyers = await Promise.all(topBuyersPromises);

      // Tính total contributed top 10
      const totalContributed = topBuyers.reduce(
        (sum, buyer) => sum + buyer.total,
        0
      );

      // Section 1: Top 3
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

      // Section 2: Rest 4-10
      const restBuyers = topBuyers.slice(3);
      let restValue = restBuyers
        .map((buyer) => {
          return `${buyer.rank}. ${
            buyer.username
          } - ${buyer.total.toLocaleString("vi-VN")} VNĐ`;
        })
        .join("\n");
      if (restBuyers.length === 0) {
        restValue = "Chưa có người góp gạo khác! 🌟";
      }

      const embed = new EmbedBuilder()
        .setColor(0xffc0cb)
        .setTitle(
          `<a:1719lpinkwing:1428650560072192113> DANH SÁCH TOP 10 VUA GÓP GẠO NUÔI YÊN <a:40349rpinkwings:1428650540904087654>`
        )
        .addFields(
          {
            name: "<a:schoolboy:1428754537677590629> TOP 3 BUYER GÓP NHIỀU GẠO NHẤT <a:schoolboy:1428754537677590629>",
            value: top3Value,
            inline: false,
          },
          {
            name: "<a:dpround:1428754521043243069> NHỮNG USER TOP 4-10 <a:dpround:1428754521043243069>",
            value: restValue,
            inline: false,
          }
        )
        .setTimestamp()
        .setFooter({
          text: trackingMsg || "Cảm ơn tất cả các bạn đã ủng hộ! 🌟",
        })
        .setImage("attachment://banner.png");

      await interaction
        .editReply({ embeds: [embed], files: [bannerAttachment] })
        .catch((err) => {
          logMessage("ERROR", `EditReply fail /top: ${err.message}`);
          interaction.followUp({
            embeds: [embed],
            files: [bannerAttachment],
            ephemeral: true,
          });
        });

      await logMessage(
        "INFO",
        `User ${currentUserId} gọi /top: ${
          topBuyers.length
        } buyers, rank của bạn: ${currentRank > 0 ? currentRank : "N/A"}`
      );
    } catch (error) {
      await logMessage("ERROR", `Lỗi /top: ${error.message}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("❌ Lỗi")
        .setDescription("Không load được top buyer, thử lại sau nhé!");
      await interaction.editReply({ embeds: [embed] }).catch((err) => {
        logMessage("ERROR", `Fallback error /top: ${err.message}`);
        interaction.followUp({ embeds: [embed], ephemeral: true });
      });
    }
  },
};
