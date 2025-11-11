const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const fs = require("fs"); // For banner check

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Xem doanh thu theo ngày (admin only) 💰"),
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
    await interaction.deferReply();

    try {
      if (typeof logMessage !== "function") {
        throw new Error("logMessage is not a function");
      }

      const sortedPayments = getSortedPayments();
      if (!Array.isArray(sortedPayments)) {
        throw new Error("Không thể lấy danh sách giao dịch.");
      }

      // Lấy unique dates từ confirmed payments (YYYY-MM-DD, sorted desc, limit 25 recent)
      const confirmedTxs = sortedPayments.filter(
        (t) => t.status === "confirmed"
      );
      const uniqueDates = [
        ...new Set(
          confirmedTxs.map(
            (tx) => new Date(tx.date).toISOString().split("T")[0]
          )
        ),
      ]
        .sort((a, b) => new Date(b) - new Date(a))
        .slice(0, 25);

      if (uniqueDates.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xffc0cb)
          .setTitle("💰 DOANH THU NGÀY")
          .setDescription("Chưa có payment confirmed nào để xem daily! 😅")
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      // Lấy tag của seller từ DEFAULT_SELLER_ID
      let sellerTag = "Unknown Seller";
      const sellerId = process.env.DEFAULT_SELLER_ID;
      if (sellerId) {
        try {
          const seller = await interaction.client.users.fetch(sellerId);
          sellerTag = seller.tag;
        } catch (error) {
          await logMessage(
            "ERROR",
            `Lỗi khi lấy thông tin seller từ ID ${sellerId}: ${error.message}`
          );
        }
      }

      // Cache simple cho buyer tags
      const buyerTagCache = new Map();

      // Hàm fetch buyer tag async
      const getBuyerTag = async (buyerId) => {
        if (buyerTagCache.has(buyerId)) return buyerTagCache.get(buyerId);
        try {
          const buyer = await interaction.client.users.fetch(buyerId);
          const tag = buyer.globalName || buyer.username || "Unknown User";
          buyerTagCache.set(buyerId, tag);
          return tag;
        } catch (error) {
          console.error(`Lỗi fetch buyer ${buyerId}: ${error.message}`);
          return buyerId.slice(-4); // Fallback short ID
        }
      };

      // Hàm filter & sum cho date cụ thể
      const getDailyData = async (targetDate) => {
        const filteredTxs = confirmedTxs.filter(
          (tx) => new Date(tx.date).toISOString().split("T")[0] === targetDate
        );
        const totalRevenue = filteredTxs.reduce(
          (sum, tx) => sum + (parseFloat(tx.amount) || 0),
          0
        );
        return { filteredTxs, totalRevenue };
      };

      // Default: Hôm nay
      const today = new Date().toISOString().split("T")[0];
      const defaultDate = uniqueDates.includes(today) ? today : uniqueDates[0];
      const { filteredTxs: defaultTxs, totalRevenue: defaultRevenue } =
        await getDailyData(defaultDate);

      // Tạo list TX đơn giản (async fetch tags, sort desc date)
      const createTxList = async (txs) => {
        if (txs.length === 0) return "Chưa có TX nào trong ngày này! 🌟";

        // Sort desc date
        const sortedTxs = txs.sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );

        // Fetch tags với delay 50ms/TX nếu nhiều
        const txWithTagsPromises = sortedTxs.map(async (tx, index) => {
          await new Promise((resolve) => setTimeout(resolve, index * 50));
          const buyerTag = await getBuyerTag(tx.buyerId);
          return `✅ ${tx.id} - ${tx.amount.toLocaleString("vi-VN", {
            style: "currency",
            currency: "VND",
          })} (${buyerTag} -> ${sellerTag}) - ${new Date(
            tx.date
          ).toLocaleDateString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          })}`;
        });
        const listItems = await Promise.all(txWithTagsPromises);
        const list = listItems.join("\n");
        const maxFieldLength = 1024;
        return list.length > maxFieldLength
          ? list.slice(0, maxFieldLength - 3) + "..."
          : list;
      };

      // Tracking cho user hiện tại (số TX + total nếu có trong ngày) - dùng defaultDate
      const currentUserId = interaction.user.id;
      const userDailyTxs = defaultTxs.filter(
        (tx) => tx.buyerId === currentUserId
      );
      const userDailyTotal = userDailyTxs.reduce(
        (sum, tx) => sum + (parseFloat(tx.amount) || 0),
        0
      );
      let trackingMsg = "";
      if (userDailyTotal > 0) {
        trackingMsg = `Bạn đã góp ${
          userDailyTxs.length
        } TX với ${userDailyTotal.toLocaleString("vi-VN")} VNĐ hôm nay 💪`;
      } else if (userDailyTxs.length > 0) {
        trackingMsg = `Bạn đã góp ${userDailyTxs.length} TX hôm nay (chờ confirm)! 😊`;
      }

      // Hàm tạo embed cho date (no files, add image nếu có banner)
      const createEmbed = async (date, hasBanner = false) => {
        const { filteredTxs, totalRevenue } = await getDailyData(date);
        const txList = await createTxList(filteredTxs);
        const embed = new EmbedBuilder()
          .setColor(0xffc0cb)
          .setTitle(`💰 DOANH THU NGÀY ${date.toUpperCase()}`)
          .addFields(
            {
              name: "📊 TỔNG KẾT",
              value: `**${
                filteredTxs.length
              } TX** | **${totalRevenue.toLocaleString("vi-VN", {
                style: "currency",
                currency: "VND",
              })}**`,
              inline: true,
            },
            {
              name: "📋 DANH SÁCH TX",
              value: txList,
              inline: false,
            }
          )
          .setTimestamp()
          .setFooter({
            text: trackingMsg || "Cảm ơn tất cả các TX trong ngày! 🌟",
          });
        if (hasBanner) embed.setImage("attachment://banner.png");
        return embed;
      };

      // Check banner tồn tại
      const hasBanner = fs.existsSync("banner.png");

      // Tạo dropdown options
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`daily_select_${interaction.id}`)
        .setPlaceholder("Chọn ngày để xem doanh thu")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Hôm nay")
            .setValue("today")
            .setDescription(`Ngày ${today}`),
          ...uniqueDates.map((date) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(date)
              .setValue(date)
              .setDescription(`Doanh thu ngày ${date}`)
          )
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      // Gửi embed default + dropdown (conditional files)
      const defaultEmbed = await createEmbed(defaultDate, hasBanner);
      const replyOptions = {
        embeds: [defaultEmbed],
        components: [row],
      };
      if (hasBanner)
        replyOptions.files = [
          new AttachmentBuilder("banner.png", { name: "banner.png" }),
        ];

      await interaction.editReply(replyOptions);

      // Ghi log
      await logMessage(
        "INFO",
        `[daily] Admin ${interaction.user.tag} xem doanh thu ${defaultDate}: ${
          defaultTxs.length
        } TX, ${defaultRevenue.toLocaleString("vi-VN", {
          style: "currency",
          currency: "VND",
        })}`
      );

      // Collector cho dropdown
      const filter = (i) =>
        i.customId === `daily_select_${interaction.id}` &&
        i.user.id === interaction.user.id;

      const collector = interaction.channel.createMessageComponentCollector({
        filter,
        time: 300000, // 5 phút
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate(); // Defer ngay để buy 15s time, tránh token expire trong fetch

        try {
          const selectedDate = i.values[0] === "today" ? today : i.values[0];
          const selectedEmbed = await createEmbed(selectedDate, hasBanner);

          const updateOptions = {
            embeds: [selectedEmbed],
          };
          if (hasBanner)
            updateOptions.files = [
              new AttachmentBuilder("banner.png", { name: "banner.png" }),
            ];

          await i.editReply(updateOptions); // Use editReply sau deferUpdate

          const { totalRevenue } = await getDailyData(selectedDate);
          await logMessage(
            "INFO",
            `[daily] Admin ${
              interaction.user.tag
            } chọn ngày ${selectedDate}: ${totalRevenue.toLocaleString(
              "vi-VN",
              { style: "currency", currency: "VND" }
            )}`
          );
        } catch (error) {
          await logMessage("ERROR", `Lỗi xử lý daily select: ${error.message}`);
          // Log only, no reply/followUp để tránh Unknown interaction loop
          if (error.code === 10062) {
            // Specific catch Unknown interaction
            console.error("Token expired, ignore reply");
          }
        }
      });

      collector.on("end", async (collected, reason) => {
        try {
          if (reason === "time") {
            await interaction.editReply({
              components: [],
              content: "Thời gian chọn ngày đã hết. Chạy lại /daily.",
            });
          }
        } catch (error) {
          console.error(
            `[ERROR] [daily] Lỗi kết thúc collector: ${error.message}`
          );
        }
      });
    } catch (error) {
      await logMessage("ERROR", `Lỗi /daily: ${error.message}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("❌ Lỗi")
        .setDescription("Không load được doanh thu daily, thử lại sau nhé!");
      await interaction.editReply({ embeds: [embed] });
    }
  },
};
