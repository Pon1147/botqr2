// commands/admin/daily.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Xem doanh thu hôm nay (admin only) 💰"),
  adminOnly: true,

  async execute(interaction, config) {
    const { paymentService, logger } = config;

    // KHÔNG deferReply ở đây nữa - handler chung đã defer rồi

    try {
      const sortedPayments = paymentService.getSortedPayments();
      const confirmedTxs = sortedPayments.filter(
        (t) => t.status === "confirmed"
      );

      if (confirmedTxs.length === 0) {
        return await interaction.editReply({
          content: "Chưa có giao dịch confirmed nào!",
        });
      }

      const todayISO = new Date().toISOString().split("T")[0];
      const todayTxs = confirmedTxs.filter((tx) => {
        const txDate = new Date(tx.date).toISOString().split("T")[0];
        return txDate === todayISO;
      });

      if (todayTxs.length === 0) {
        return await interaction.editReply({
          content: "Chưa có giao dịch confirmed nào hôm nay!",
        });
      }

      const totalRevenue = todayTxs.reduce(
        (sum, tx) => sum + (Number(tx.amount) || 0),
        0
      );

      let sellerTag = "Unknown Seller";
      const sellerId = process.env.DEFAULT_SELLER_ID;
      if (sellerId) {
        try {
          const seller = await interaction.client.users.fetch(sellerId);
          sellerTag = seller.tag;
        } catch {}
      }

      const buyerTagCache = new Map();
      const getBuyerTag = async (buyerId) => {
        if (buyerTagCache.has(buyerId)) return buyerTagCache.get(buyerId);
        try {
          const buyer = await interaction.client.users.fetch(buyerId);
          const tag = buyer.globalName || buyer.username || "Unknown";
          buyerTagCache.set(buyerId, tag);
          return tag;
        } catch {
          return buyerId.slice(-4);
        }
      };

      const txListItems = await Promise.all(
        todayTxs
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map(async (tx, index) => {
            await new Promise((r) => setTimeout(r, index * 50));
            const buyerTag = await getBuyerTag(tx.buyerId);
            return `✅ ${tx.id} - ${(Number(tx.amount) || 0).toLocaleString(
              "vi-VN",
              {
                style: "currency",
                currency: "VND",
              }
            )} (${buyerTag} → ${sellerTag}) - ${new Date(
              tx.date
            ).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
            })}`;
          })
      );

      const txList = txListItems.join("\n") || "Chưa có TX";

      const bannerPath = path.join(__dirname, "../../banner.png");
      const hasBanner = fs.existsSync(bannerPath);
      const bannerAttachment = hasBanner
        ? new AttachmentBuilder(bannerPath, { name: "banner.png" })
        : null;

      const embed = new EmbedBuilder()
        .setColor(0xffc0cb)
        .setTitle(
          `💰 DOANH THU HÔM NAY (${new Date().toLocaleDateString("vi-VN")})`
        )
        .addFields(
          {
            name: "📊 Tổng doanh thu",
            value: `${totalRevenue.toLocaleString("vi-VN", {
              style: "currency",
              currency: "VND",
            })}`,
            inline: true,
          },
          {
            name: "📋 Số giao dịch",
            value: todayTxs.length.toString(),
            inline: true,
          },
          { name: "Danh sách TX", value: txList }
        )
        .setTimestamp()
        .setFooter({ text: "Cảm ơn các bạn đã ủng hộ hôm nay!" });

      if (hasBanner) embed.setImage("attachment://banner.png");

      const options = { embeds: [embed] };
      if (hasBanner) options.files = [bannerAttachment];

      await interaction.editReply(options);

      await logger.info(
        `[daily] ${interaction.user.tag} xem doanh thu hôm nay: ${
          todayTxs.length
        } TX, ${totalRevenue.toLocaleString("vi-VN", {
          style: "currency",
          currency: "VND",
        })}`
      );
    } catch (error) {
      await logger.error(`Lỗi /daily: ${error.message}`);

      await interaction
        .editReply({
          content: "Có lỗi khi load doanh thu, thử lại sau!",
        })
        .catch(() => {});
    }
  },
};
