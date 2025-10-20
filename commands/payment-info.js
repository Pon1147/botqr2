// commands/payment-info.js - Public Command
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("payment-info")
    .setDescription("Xem chi tiết giao dịch")
    .addStringOption((option) =>
      option
        .setName("transaction_code")
        .setDescription("Mã giao dịch (hoặc dùng user)")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User để xem tổng (chỉ admin)")
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
  adminOnly: false,
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
    const txCode = interaction.options
      .getString("transaction_code")
      ?.toUpperCase();
    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type") || "seller";
    const userId = interaction.user.id;
    const userTag = interaction.user.tag;
    const isAdmin = interaction.member.permissions.has("Administrator");

    if (txCode) {
      const tx = paymentsData.find((t) => t.id === txCode);
      if (!tx)
        return interaction.reply({
          content: "Giao dịch không tồn tại!",
          ephemeral: true,
        });

      if (!isAdmin && tx.sellerId !== userId && tx.buyerId !== userId) {
        return interaction.reply({
          content: "Bạn chỉ có thể xem TX của mình!",
          ephemeral: true,
        });
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
          {
            name: "Buyer (Người trả)",
            value: `<@${tx.buyerId}>`,
            inline: true,
          }, // Fix: Dùng tx.buyerId
          {
            name: "Seller (Người nhận)",
            value: `<@${tx.sellerId}>`,
            inline: true,
          }, // Fix: Dùng tx.sellerId
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

      await logMessage(`[payment-info] User ${userTag} xem TX ${txCode}`);
      await interaction.reply({ embeds: [embed], ephemeral: false }); // Public cho chi tiết TX
    } else if (targetUser) {
      if (!isAdmin) {
        return interaction.reply({
          content: "Chỉ admin xem user khác!",
          ephemeral: true,
        });
      }

      const userIdTarget = targetUser.id;
      const userTxs = paymentsData.filter((t) => {
        if (type === "seller")
          return t.sellerId === userIdTarget && t.status === "confirmed";
        if (type === "buyer")
          return t.buyerId === userIdTarget && t.status === "confirmed";
        return false;
      });
      const totalAmount = userTxs.reduce((sum, tx) => sum + tx.amount, 0);
      const completedCount = userTxs.length;

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
          `👤 User: ${targetUser} (${
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

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else {
      // Default: View tổng của mình (seller)
      const userTxs = paymentsData.filter(
        (t) => t.sellerId === userId && t.status === "confirmed"
      );
      const totalAmount = userTxs.reduce((sum, tx) => sum + tx.amount, 0);
      const completedCount = userTxs.length;

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
        .setTitle(`👤 Bạn (Seller - Tiền nhận)`)
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

      await logMessage(`[payment-info] User ${userTag} xem tổng của mình`);
      await interaction.reply({ embeds: [embed], ephemeral: false }); // Public cho tổng
    }
  },
};
