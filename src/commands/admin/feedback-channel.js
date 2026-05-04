const {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("feedback-channel")
    .setDescription("Cấu hình kênh nhận feedback (chỉ admin)")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Hành động")
        .setRequired(true)
        .addChoices(
          { name: "Thiết lập", value: "set" },
          { name: "Hiển thị", value: "show" },
          { name: "Xóa", value: "clear" }
        )
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Kênh nhận feedback")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),
  adminOnly: true,
  ephemeral: true,

  async execute(interaction, config) {
    const {
      logger,
      SHEETS_ID,
      getSetting,
      setSetting,
      clearSetting,
    } = config;

    const action = interaction.options.getString("action");
    const key = "FEEDBACK_CHANNEL_ID";

    if (action === "show") {
      let channelId = config.FEEDBACK_CHANNEL_ID || "";
      if (!channelId) {
        channelId = (await getSetting(SHEETS_ID, key).catch(() => null)) || "";
      }

      if (!channelId) {
        return interaction.editReply({
          content: "Chưa cấu hình kênh feedback. Dùng /feedback-channel action:set.",
        });
      }

      config.FEEDBACK_CHANNEL_ID = channelId;
      return interaction.editReply({
        content: `Kênh feedback hiện tại: <#${channelId}> (\`${channelId}\`)`,
      });
    }

    if (action === "clear") {
      await clearSetting(SHEETS_ID, key);
      config.FEEDBACK_CHANNEL_ID = "";

      await logger.info(
        `[feedback-channel] Admin ${interaction.user.tag} xóa feedback channel`,
        SHEETS_ID
      );

      return interaction.editReply({
        content: "Đã xóa cấu hình kênh feedback.",
      });
    }

    const channel = interaction.options.getChannel("channel");
    if (!channel) {
      return interaction.editReply({
        content: "Hành động thiết lập cần tham số channel.",
      });
    }

    await setSetting(SHEETS_ID, key, channel.id);
    config.FEEDBACK_CHANNEL_ID = channel.id;

    await logger.info(
      `[feedback-channel] Admin ${interaction.user.tag} set feedback channel: ${channel.id}`,
      SHEETS_ID
    );

    const embed = new EmbedBuilder()
      .setColor(0xffb5da)
      .setTitle("Đã cập nhật kênh feedback")
      .setDescription(`Feedback sẽ được gửi đến ${channel}`)
      .addFields({ name: "Channel ID", value: channel.id, inline: true })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
