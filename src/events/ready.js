// src/events/ready.js (cập nhật để tránh unhandled error)
const { Events } = require("discord.js");

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client, config) {
    try {
      const {
        logger,
        qrDataService,
        paymentService,
        loadCapitalFromSheet,
        GUILD_ID,
        SHEETS_ID,
      } = config;

      await logger.info(`Bot đã online: ${client.user.tag}`, SHEETS_ID);

      await qrDataService.loadQrDataFromSheet(SHEETS_ID);
      await paymentService.loadPaymentsFromSheet(SHEETS_ID);
      await loadCapitalFromSheet(config); // Truyền config để hàm dùng getValues/logger

      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        await logger.error(`Guild không tồn tại: ${GUILD_ID}`, SHEETS_ID);
        return;
      }

      const commands = Array.from(client.commands.values()).map((cmd) =>
        cmd.data.toJSON()
      );
      await guild.commands.set(commands);
      await logger.info(
        `Đồng bộ ${commands.length} lệnh cho guild ${guild.name}`,
        SHEETS_ID
      );
    } catch (error) {
      config.logger.error(
        `Lỗi trong ready event: ${error.message}\nStack: ${error.stack}`,
        config.SHEETS_ID
      );
    }
  },
};
