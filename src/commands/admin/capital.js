const { SlashCommandBuilder } = require("discord.js");
const { handleCapitalCommand } = require("../../flows/capitalFlow");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("capital")
    .setDescription("Dashboard tài chính (admin only)"),
  adminOnly: true,
  ephemeral: false,

  async execute(interaction, config) {
    return handleCapitalCommand(interaction, config);
  },
};
