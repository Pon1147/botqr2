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
    .setName("menu")
    .setDescription("Hiển thị menu dịch vụ cho khách hàng (admin only)"),

  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    const { logger, categoriesService, subItemsService } = config;

    try {
      const allCategories = await categoriesService.getCategories(config, true);

      if (allCategories.length === 0) {
        await interaction.editReply({
          content: "Không tìm thấy danh mục active nào trong sheet 'Categories'. Vui lòng thêm dữ liệu!",
          components: [],
          embeds: [],
        });
        return;
      }

      const uniqueMap = new Map();
      allCategories.forEach((cat) => {
        if (uniqueMap.has(cat.value)) {
          logger.warn(`Duplicate value skipped: ${cat.value} (Label: ${cat.label})`);
        } else {
          uniqueMap.set(cat.value, cat);
        }
      });
      const categories = Array.from(uniqueMap.values());

      if (categories.length === 0) {
        await interaction.editReply({
          content: "Tất cả danh mục đều trùng value hoặc invalid. Vui lòng sửa sheet 'Categories'.",
          components: [],
          embeds: [],
        });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("menu_select")
        .setPlaceholder("Chọn danh mục để xem chi tiết...")
        .addOptions(
          categories.map((cat) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(cat.label)
              .setValue(cat.value)
          )
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle("📋 Menu Dịch Vụ Nhanh")
        .setDescription("Chọn danh mục dịch vụ bên dưới để xem chi tiết.")
        .setTimestamp()
        .setFooter({ text: "Tin nhắn tự xóa sau 5 phút" });

      const message = await interaction.editReply({
        embeds: [embed],
        components: [row],
        fetchReply: true,
      });

      const filter = (i) => i.customId === "menu_select";

      const collector = message.createMessageComponentCollector({
        filter,
        componentType: ComponentType.StringSelect,
        time: 5 * 60 * 1000,
      });

      collector.on("collect", async (i) => {
        const selectedValue = i.values[0];
        const selected = categories.find((c) => c.value === selectedValue);

        if (!selected) {
          return i.reply({ content: "Danh mục không hợp lệ!", ephemeral: true });
        }

        const subItems = await subItemsService.getSubItemsByCategory(config, selected.value);
        await logger.info(`[menu] Selected: ${selected.value} - Found ${subItems.length} subitems`);

        if (subItems.length > 0) {
          const subEmbed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle(`${selected.label} - Chi tiết dịch vụ`)
            .setDescription("Dưới đây là bảng giá chi tiết. Inbox để đặt hàng nhé!")
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
              .map((item) => `**${item.subName}** - ${item.subPrice}${item.subDesc ? ` (${item.subDesc})` : ""}`)
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

        // Không có sub → chỉ hiển thị mô tả (xóa field giá)
        const replyEmbed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setTitle(selected.label)
          .addFields(
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
            await logger.info(`[menu] Tin nhắn menu tự xóa sau 5 phút - ${interaction.user.tag}`);
          } catch (err) {
            await logger.error(`Lỗi xóa tin nhắn menu: ${err.message}`);
          }
        }
      });

      await logger.info(`[menu] Admin ${interaction.user.tag} tạo menu dịch vụ với ${categories.length} danh mục`);
    } catch (error) {
      await logger.error(`Lỗi /menu: ${error.message}`);
      await interaction.editReply({
        content: "Có lỗi khi tạo menu dịch vụ. Thử lại sau!",
        components: [],
        embeds: [],
      }).catch(() => {});
    }
  },
};