const { SlashCommandBuilder } = require("discord.js");
const { handleQrDashboardCommand } = require("../../flows/qrDashboardFlow");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("qr")
    .setDescription("Dashboard quản lý QR thanh toán (admin only)")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User cần quản lý QR (mặc định: seller)")
        .setRequired(false),
    ),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    return handleQrDashboardCommand(interaction, config);
  },
};
