const {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
  AttachmentBuilder,
} = require("discord.js");
const path = require('path');

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
          content:
            "Không tìm thấy danh mục active nào trong sheet 'Categories'. Vui lòng thêm dữ liệu!",
          components: [],
          embeds: [],
        });
        return;
      }

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
            "Tất cả danh mục đều trùng value hoặc invalid. Vui lòng sửa sheet 'Categories'.",
          components: [],
          embeds: [],
        });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("menu_select")
        .setPlaceholder("Chọn danh mục dịch vụ ♥")
        .addOptions(
          categories.map((cat) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(cat.label)
              .setValue(cat.value)
          )
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const assetsDir = path.join(process.cwd(), "src/assets");
      const bannerPath = path.join(assetsDir, "banner.png");
      const thumbPath = path.join(assetsDir, "thumbnails.jpg");

      const bannerAttachment = new AttachmentBuilder(bannerPath, { name: "banner.png" });
      const thumbAttachment = new AttachmentBuilder(thumbPath, { name: "thumbnails.jpg" });

      const embed = new EmbedBuilder()
        .setColor(0xff69b4)
        .setTitle("🌸 Ô NHỎ CỦA YÊN - DỊCH VỤ 🌸")
        .setDescription(
          "**DỊCH VỤ LAO CÔNG - Ô NHỎ CỦA YÊN**\n" +
          "Chọn danh mục bên dưới để xem bảng giá chi tiết nhé!\n" +
          "Inbox để được tư vấn miễn phí ♥"
        )
        .setThumbnail("attachment://thumbnails.jpg")
        .setImage("attachment://banner.png")
        .setTimestamp()
        .setFooter({ text: "Ô Nhỏ Của Yên • Hỗ trợ 24/7 ♥" })
        .setAuthor({
          name: "Cherub Bot",
          iconURL: "https://cdn.discordapp.com/emojis/1460549231784890499.webp?size=96",
          url: "https://discord.gg/DB7avP53SG",
        });

      const message = await interaction.editReply({
        embeds: [embed],
        components: [row],
        files: [bannerAttachment, thumbAttachment],
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
          `[menu] Selected: ${selected.value} - Found ${subItems.length} subitems`
        );

        if (subItems.length > 0) {
          const subEmbed = new EmbedBuilder()
            .setColor(0xff69b4)
            .setTitle(`🌸 ${selected.label} - BẢNG GIÁ CHI TIẾT 🌸`)
            .setDescription(
              "Giá có thể thay đổi tùy yêu cầu. Inbox để báo giá chính xác và nhận ưu đãi nhé! 💕"
            )
            .setTimestamp()
            .setFooter({ text: "Ô Nhỏ Của Yên • Cảm ơn đã ủng hộ ♥" });

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

        // Không có sub items
        const replyEmbed = new EmbedBuilder()
          .setColor(0xff69b4)
          .setTitle(`🌸 ${selected.label} 🌸`)
          .addFields({
            name: "Mô tả",
            value:
              selected.desc ||
              "Không có mô tả chi tiết. Inbox để được tư vấn nhé! 💖",
          })
          .setTimestamp();

        if (selected.imageUrl) replyEmbed.setThumbnail(selected.imageUrl);

        await i.reply({ embeds: [replyEmbed], ephemeral: true });
      });

      collector.on("end", async (_, reason) => {
        if (reason === "time") {
          try {
            await message.delete();
            await logger.info(
              `[menu] Tin nhắn menu tự xóa sau 5 phút - ${interaction.user.tag}`
            );
          } catch (err) {
            await logger.error(`Lỗi xóa tin nhắn menu: ${err.message}`);
          }
        }
      });

      await logger.info(
        `[menu] Admin ${interaction.user.tag} tạo menu dịch vụ với ${categories.length} danh mục`
      );
    } catch (error) {
      await logger.error(`Lỗi /menu: ${error.message}`);
      await interaction
        .editReply({
          content: "Có lỗi khi tạo menu dịch vụ. Thử lại sau!",
          components: [],
          embeds: [],
        })
        .catch(() => {});
    }
  },
};
