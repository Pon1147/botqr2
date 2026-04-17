const { SlashCommandBuilder } = require("discord.js");
const { handleInfoCommand } = require("../../flows/infoFlow");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Dashboard giao dịch (admin only)"),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    return handleInfoCommand(interaction, config);
  },
};
