const {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("quote")
    .setDescription("Generate quick quote menu for customer (admin only)"),

  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { logger, categoriesService, subItemsService } = config;

    try {
      const allCategories = await categoriesService.getCategories(config);

      if (allCategories.length === 0) {
        await interaction.editReply({
          content:
            "No active categories found in sheet 'Categories'! Please add some products first.",
          components: [],
          embeds: [],
        });
        return;
      }

      // Loại bỏ duplicate value
      const uniqueMap = new Map();
      allCategories.forEach((cat) => {
        if (uniqueMap.has(cat.value)) {
          logger.warn(
            `Duplicate value skipped: ${cat.value} (Label: ${cat.label})`
          );
        } else {
          uniqueMap.set(cat.value, cat);
        }
      });
      const categories = Array.from(uniqueMap.values());

      if (categories.length === 0) {
        await interaction.editReply({
          content:
            "All categories have duplicate/invalid values. Fix sheet 'Categories'.",
          components: [],
          embeds: [],
        });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("quote_select")
        .setPlaceholder("Chọn danh mục để xem chi tiết...")
        .addOptions(
          categories.map((cat) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(cat.label)
              .setValue(cat.value)
              .setDescription(
                `Giá: ${
                  cat.price
                    ? Number(cat.price).toLocaleString("vi-VN") + " VNĐ"
                    : "Inbox"
                }`
              )
          )
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle("📋 Bảng Báo Giá Nhanh")
        .setDescription("Chọn danh mục dịch vụ bên dưới để xem chi tiết.")
        .setTimestamp()
        .setFooter({ text: "Tin nhắn tự xóa sau 5 phút" });

      const message = await interaction.editReply({
        embeds: [embed],
        components: [row],
        fetchReply: true,
      });

      const filter = (i) => i.customId === "quote_select";

      const collector = message.createMessageComponentCollector({
        filter,
        componentType: ComponentType.StringSelect,
        time: 5 * 60 * 1000,
      });

      collector.on("collect", async (i) => {
        const selectedValue = i.values[0];
        const selected = categories.find((c) => c.value === selectedValue);

        if (!selected) {
          return i.reply({
            content: "Danh mục không hợp lệ!",
            ephemeral: true,
          });
        }

        const subItems = await subItemsService.getSubItemsByCategory(
          config,
          selected.value
        );
        await logger.info(
          `[quote] Selected: ${selected.value} - Found ${subItems.length} subitems`
        );

        if (subItems.length > 0) {
          const subEmbed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${selected.label} - Chi tiết dịch vụ`)
            .setDescription(
              "Dưới đây là bảng giá chi tiết. Inbox để đặt hàng nhé!"
            )
            .setTimestamp()
            .setFooter({ text: "Ô Nhỏ Của Yên - Dịch vụ chất lượng cao" });

          const grouped = {};
          subItems.forEach((item) => {
            const key = item.groupEmoji || "Khác";
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
          });

          Object.entries(grouped).forEach(([emoji, group]) => {
            const fieldValue = group
              .map(
                (item) =>
                  `**${item.subName}** - ${item.subPrice}${
                    item.subDesc ? ` (${item.subDesc})` : ""
                  }`
              )
              .join("\n");

            subEmbed.addFields({
              name: `${emoji} Nhóm`,
              value: fieldValue || "Chưa có dịch vụ",
              inline: false,
            });
          });

          if (selected.imageUrl) subEmbed.setThumbnail(selected.imageUrl);

          return i.reply({ embeds: [subEmbed], ephemeral: true });
        }

        // Không có sub
        const replyEmbed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setTitle(selected.label)
          .addFields(
            {
              name: "💰 Giá",
              value: selected.price
                ? `${Number(selected.price).toLocaleString("vi-VN")} VNĐ`
                : "Inbox",
              inline: true,
            },
            {
              name: "Mô tả",
              value: selected.desc || "Không có mô tả",
            }
          )
          .setTimestamp();

        if (selected.imageUrl) replyEmbed.setThumbnail(selected.imageUrl);

        await i.reply({ embeds: [replyEmbed], ephemeral: true });
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          try {
            await message.delete();
            await logger.info(
              `[quote] Tin nhắn báo giá tự xóa sau 5 phút - ${interaction.user.tag}`
            );
          } catch (err) {
            await logger.error(`Lỗi xóa tin nhắn quote: ${err.message}`);
          }
        }
      });

      await logger.info(
        `[quote] Admin ${interaction.user.tag} tạo menu báo giá với ${categories.length} danh mục`
      );
    } catch (error) {
      await logger.error(`Lỗi /quote: ${error.message}`);
      await interaction
        .editReply({
          content: "Có lỗi khi tạo menu báo giá. Thử lại sau!",
          components: [],
          embeds: [],
        })
        .catch(() => {});
    }
  },
};
