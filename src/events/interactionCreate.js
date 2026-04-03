const { Events } = require("discord.js");
const { handleInteraction } = require("../handlers/interactionRouter");

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, config) {
    return handleInteraction(interaction, config);
  },
};
